
import csv
import http.client
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
if __package__:
    from .lunar_sites import SITES
else:
    from lunar_sites import SITES

# 2. EDIT THESE SETTINGS
# Dates are UTC, in YYYY-MM-DD HH:MM format.
START_TIME = "2026-01-01 00:00"
STOP_TIME = "2026-12-31 23:59"
STEP_MINUTES = 60                       # 60 means one reading per hour.
HEIGHT_KM = 0.0                         # Height above the lunar reference surface, km.
OUTPUT_FOLDER = Path("lunar_results2")   # Change this to keep a separate run.


# 3. THE NINE LUNAR POINTS
# Each line gives: name, east longitude, latitude (angles in degrees).
# Negative longitude means west; negative latitude means south.
# SITES is loaded from lunar_sites.py by the import at the top.

TARGETS = [("Earth", "399"), ("Sun", "10")]  # JPL's body codes.

CSV_HEADER = [
    "region", "utc",
    "site_from_earth_x_km", "site_from_earth_y_km", "site_from_earth_z_km",
    "earth_zenith_deg",
    "site_from_sun_x_km", "site_from_sun_y_km", "site_from_sun_z_km",
    "solar_zenith_deg",
    "earth_azimuth_deg", "sun_azimuth_deg",
]


class HorizonsError(RuntimeError):
    """Horizons could not supply a complete, valid ephemeris."""


class HorizonsTimeout(HorizonsError):
    """Horizons exceeded the allowed waiting time."""


UPSTREAM_REQUEST_TIMEOUT_SECONDS = 30.0
_horizons_request_lock = Lock()


# 4. ASK JPL FOR ONE TABLE
#The data rows lie between $$SOE (Start Of Ephemeris) and $$EOE (End Of Ephemeris).
def get_table(settings, *, timeout_seconds=180):
    parameters = {"format": "text"}
    for name, value in settings.items():
        parameters[name] = "'" + value + "'"
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?"
    url += urllib.parse.urlencode(parameters)

    deadline = time.monotonic() + timeout_seconds
    if not _horizons_request_lock.acquire(timeout=timeout_seconds):
        raise HorizonsTimeout("Horizons request timed out while waiting for the client.")
    try:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HorizonsTimeout("Horizons request timed out while waiting for the client.")
        request = urllib.request.Request(url, headers={
            "User-Agent": "SELENE/1.0 (https://github.com/Artepace/lunar_landing_challenge)",
        })
        with urllib.request.urlopen(request, timeout=remaining) as response:
            text = response.read().decode("utf-8")
    except TimeoutError as error:
        raise HorizonsTimeout("Horizons request timed out.") from error
    except urllib.error.HTTPError as error:
        raise HorizonsError("Horizons returned an HTTP error.") from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise HorizonsTimeout("Horizons request timed out.") from error
        raise HorizonsError("Could not contact Horizons.") from error
    except (OSError, UnicodeError, http.client.HTTPException) as error:
        raise HorizonsError("Could not read the Horizons response.") from error
    finally:
        _horizons_request_lock.release()

    if "$$SOE" not in text or "$$EOE" not in text:
        raise HorizonsError("Horizons returned no complete table.")
    if not re.search(r"^Center body name:\s+Moon\s+\(301\)", text, re.MULTILINE):
        raise HorizonsError("The observing body must be the Moon.")
    target_name = "Earth" if settings["COMMAND"] == "399" else "Sun"
    pattern = rf"^Target body name:\s+{target_name}\s+\({settings['COMMAND']}\)"
    if not re.search(pattern, text, re.MULTILINE):
        raise HorizonsError("Horizons returned the wrong target.")
    if settings["EPHEM_TYPE"] == "VECTORS":
        if "GEOMETRIC cartesian states" not in text or "Reference frame : ICRF" not in text:
            raise HorizonsError("Expected geometric XYZ in ICRF axes.")

    header_text, data_text = text.split("$$SOE", 1)
    data_text = data_text.split("$$EOE", 1)[0]
    header = []
    try:
        for line in header_text.splitlines():
            if "Date__(UT)" in line or "Calendar Date" in line:
                header = [name.strip() for name in next(csv.reader([line]))]
        rows = list(csv.reader(data_text.strip().splitlines()))
    except (csv.Error, StopIteration) as error:
        raise HorizonsError("Could not parse the Horizons table.") from error
    if not header:
        raise HorizonsError("Horizons table header is missing.")
    return header, rows


# 5. READ JPL'S DATE FORMAT
# This accepts both observer dates and vector dates, and makes a Python
# datetime so the two tables can be matched to the same instant.
def read_time(value):
    date_text, time_text = value.strip().removeprefix("A.D. ").split()
    year, month, day = date_text.split("-")
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    clock = time_text.split(":")
    if len(clock) not in (2, 3):
        raise ValueError("Unexpected Horizons clock format.")
    seconds = float(clock[2]) if len(clock) == 3 else 0
    date = datetime(
        int(year), months.index(month) + 1, int(day), int(clock[0]), int(clock[1])
    )
    return date + timedelta(seconds=seconds)


# Reusable observer calculations for the CSV script and the web API.
# API callers pass their coordinates and times explicitly. These functions
# never create folders or CSV files and do not read the batch date globals.
def as_utc(value):
    """Treat a naive datetime as UTC, or convert an aware datetime to UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def utc_text(value):
    return as_utc(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_window(start_utc, stop_utc, step_minutes):
    start_utc, stop_utc = as_utc(start_utc), as_utc(stop_utc)
    if stop_utc <= start_utc or type(step_minutes) is not int or step_minutes <= 0:
        raise ValueError("Use a later stop time and a positive whole-minute step.")
    if any(t.second or t.microsecond for t in (start_utc, stop_utc)):
        raise ValueError("Times must be aligned to a whole minute.")
    return start_utc, stop_utc


def build_site_settings(*, latitude, longitude, body_code, start_utc, stop_utc,
                        step_minutes, height_km=0.0):
    """The order in SITE_COORD is longitude, latitude, height in kilometres."""
    return {
        "COMMAND": body_code,
        "CENTER": "coord@301",
        "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"{longitude},{latitude},{height_km}",
        "START_TIME": as_utc(start_utc).replace(tzinfo=None).isoformat(sep=" ", timespec="minutes"),
        "STOP_TIME": as_utc(stop_utc).replace(tzinfo=None).isoformat(sep=" ", timespec="minutes"),
        "STEP_SIZE": f"{step_minutes} min",
        "TIME_TYPE": "UT",
        "CAL_TYPE": "GREGORIAN",
        "CSV_FORMAT": "YES",
        "MAKE_EPHEM": "YES",
        "OBJ_DATA": "NO",
    }


def build_observer_settings(site_settings):
    settings = site_settings.copy()
    settings.update({
        "EPHEM_TYPE": "OBSERVER", "QUANTITIES": "4",
        "APPARENT": "AIRLESS", "TIME_DIGITS": "MINUTES",
        "CAL_FORMAT": "CAL", "ELEV_CUT": "-90", "SKIP_DAYLT": "NO",
    })
    return settings


def parse_observer_table(header, rows, *, start_utc, stop_utc, step_minutes):
    """Return checked airless apparent azimuth/elevation readings, in UTC order."""
    start_utc, stop_utc = validate_window(start_utc, stop_utc, step_minutes)
    interval = timedelta(minutes=step_minutes)
    expected_count = (stop_utc - start_utc) // interval + 1
    if len(rows) != expected_count:
        raise HorizonsError("Horizons returned an incomplete observer time series.")
    try:
        azimuth_column = header.index("Azi_(a-app)")
        elevation_column = header.index("Elev_(a-app)")
        readings = []
        for index, row in enumerate(rows):
            stamp = as_utc(read_time(row[0]))
            if stamp != start_utc + index * interval:
                raise HorizonsError("Horizons observer timestamps do not match the request.")
            azimuth = float(row[azimuth_column])
            elevation = float(row[elevation_column])
            if not (math.isfinite(azimuth) and math.isfinite(elevation)
                    and 0 <= azimuth <= 360 and -90 <= elevation <= 90):
                raise HorizonsError("Horizons returned an invalid observer angle.")
            readings.append({
                "utc": utc_text(stamp),
                # Horizons can round azimuth to 360; the API uses [0, 360).
                "azimuthDeg": azimuth % 360,
                "elevationDeg": elevation,
            })
    except (ValueError, IndexError, TypeError, OverflowError) as error:
        raise HorizonsError("Could not parse Horizons observer readings.") from error
    return readings


def query_observer_directions(*, latitude, longitude, body_code, start_utc,
                              stop_utc, step_minutes, timeout_seconds=180):
    site_settings = build_site_settings(
        latitude=latitude, longitude=longitude, body_code=body_code,
        start_utc=start_utc, stop_utc=stop_utc, step_minutes=step_minutes,
    )
    header, rows = get_table(
        build_observer_settings(site_settings), timeout_seconds=timeout_seconds,
    )
    return parse_observer_table(
        header, rows, start_utc=start_utc, stop_utc=stop_utc, step_minutes=step_minutes,
    )


def calculate_visibility(*, latitude, longitude, start_utc, stop_utc,
                         step_minutes, timeout_seconds=60.0):
    """Query each target once and pair the Sun and Earth readings by UTC.

    Inputs are explicit to keep this path independent of annual CSV settings.
    Returned directions are airless apparent directions at the lunar site.
    """
    for value, limit in ((latitude, 90), (longitude, 180)):
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not -limit <= value <= limit):
            raise ValueError("Invalid latitude or longitude.")
    start_utc, stop_utc = validate_window(start_utc, stop_utc, step_minutes)
    deadline = time.monotonic() + timeout_seconds
    bodies = {}
    for name, code in (("sun", "10"), ("earth", "399")):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HorizonsTimeout("Horizons time budget expired.")
        bodies[name] = query_observer_directions(
            latitude=latitude, longitude=longitude, body_code=code,
            start_utc=start_utc, stop_utc=stop_utc, step_minutes=step_minutes,
            timeout_seconds=min(UPSTREAM_REQUEST_TIMEOUT_SECONDS, remaining),
        )
        if time.monotonic() > deadline:
            raise HorizonsTimeout("Horizons time budget expired.")
    samples = []
    for sun, earth in zip(bodies["sun"], bodies["earth"]):
        if sun["utc"] != earth["utc"]:
            raise HorizonsError("Sun and Earth timestamps do not match.")
        samples.append({
            "utc": sun["utc"],
            "sun": {"azimuthDeg": sun["azimuthDeg"], "elevationDeg": sun["elevationDeg"]},
            "earth": {"azimuthDeg": earth["azimuthDeg"], "elevationDeg": earth["elevationDeg"]},
        })
    return samples


# 6. DOWNLOAD THE CSV MEASUREMENTS, INCLUDING SUN AND EARTH AZIMUTH
# For each body, the observer table supplies elevation for its zenith angle.
# The vector table supplies XYZ. Only the requested measurements go into CSVs.
def main():
    start = datetime.strptime(START_TIME, "%Y-%m-%d %H:%M")
    stop = datetime.strptime(STOP_TIME, "%Y-%m-%d %H:%M")
    if stop <= start or not isinstance(STEP_MINUTES, int) or STEP_MINUTES <= 0:
        raise ValueError("Use a later stop time and a positive whole-minute step.")
    interval = timedelta(minutes=STEP_MINUTES)
    number_of_times = (stop - start) // interval + 1
    OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)
    print("Saving CSV files to:", OUTPUT_FOLDER.resolve(), flush=True)
    combined_rows = []

    for site_name, longitude, latitude in SITES:
        print("Downloading:", site_name, flush=True)
        results = {}
        for body_name, body_code in TARGETS:
            # Settings shared by the two requests. coord@301 means the
            # observer is at the supplied GEODETIC point on the Moon.
            settings = build_site_settings(
                latitude=latitude, longitude=longitude, body_code=body_code,
                start_utc=start, stop_utc=stop, step_minutes=STEP_MINUTES,
                height_km=HEIGHT_KM,
            )

            # First GET request: elevation. Quantity 4 is azimuth/elevation;
            # we use its elevation column to calculate zenith = 90 - elevation.
            observer_settings = build_observer_settings(settings)
            observer_header, observer_rows = get_table(observer_settings)
            observer_readings = parse_observer_table(
                observer_header, observer_rows, start_utc=start, stop_utc=stop,
                step_minutes=STEP_MINUTES,
            )

            # Second GET request: geometric XYZ with fixed ICRF axes, in km.
            # VEC_CORR=NONE gives positions at the same instant.
            vector_settings = settings.copy()
            vector_settings.update({
                "EPHEM_TYPE": "VECTORS", "VEC_TABLE": "1",
                "REF_SYSTEM": "ICRF", "REF_PLANE": "FRAME",
                "VEC_CORR": "NONE", "OUT_UNITS": "KM-S",
            })
            vector_header, vector_rows = get_table(vector_settings)
            x_column = vector_header.index("X")
            y_column = vector_header.index("Y")
            z_column = vector_header.index("Z")
            if len(observer_rows) != number_of_times or len(vector_rows) != number_of_times:
                raise ValueError("JPL returned an unexpected number of readings.")

            body_results = []
            for index, (observer, vector) in enumerate(zip(observer_readings, vector_rows)):
                expected_time = start + index * interval
                vector_time = read_time(vector[1])
                if observer["utc"] != utc_text(expected_time) or vector_time != expected_time:
                    raise ValueError("The observer and vector times do not match the settings.")

                # Reverse JPL's site-to-body vector to get body-centre-to-site.
                x = -float(vector[x_column])
                y = -float(vector[y_column])
                z = -float(vector[z_column])
                zenith = round(90.0 - observer["elevationDeg"], 6)
                if not all(math.isfinite(n) for n in [x, y, z, zenith]) or not 0 <= zenith <= 180:
                    raise ValueError("An XYZ value or zenith angle is invalid.")
                body_results.append([x, y, z, zenith, observer["azimuthDeg"]])
            results[body_name] = body_results
            print(" ", body_name, "readings:", len(body_results), flush=True)

        # Match the Earth and Sun results for each timestamp.
        site_rows = []
        for index in range(number_of_times):
            utc = (start + index * interval).isoformat(timespec="seconds") + "Z"
            earth, sun = results["Earth"][index], results["Sun"][index]
            # Preserve the original ten columns; append the new azimuths.
            row = [site_name, utc] + earth[:4] + sun[:4] + [earth[4], sun[4]]
            site_rows.append(row)
        combined_rows += site_rows

        file_name = site_name.lower().replace(" ", "_") + ".csv"
        with (OUTPUT_FOLDER / file_name).open("w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(CSV_HEADER)
            writer.writerows(site_rows)

    # Publish the combined file after all nine regions succeed.
    temporary = OUTPUT_FOLDER / "combined.csv.part"
    with temporary.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(CSV_HEADER)
        writer.writerows(combined_rows)
    temporary.replace(OUTPUT_FOLDER / "combined.csv")
    print("Finished. Open combined.csv in:", OUTPUT_FOLDER.resolve())


# 7. START THE SCRIPT AND REPORT ANY ERROR
if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, HorizonsError) as error:
        raise SystemExit(f"Stopped: {error}")
