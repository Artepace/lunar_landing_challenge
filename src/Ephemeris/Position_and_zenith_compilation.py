import csv
import math
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from lunar_sites import SITES


# 2. EDIT THESE SETTINGS
# Dates are UTC, in YYYY-MM-DD HH:MM format.
START_TIME = "2026-01-01 00:00"
STOP_TIME = "2026-12-31 23:59"
STEP_MINUTES = 60                       # One reading per hour.
HEIGHT_KM = 0.0                         # Height above the lunar reference surface.
OUTPUT_FOLDER = Path("lunar_results2")


# 3. LUNAR POINTS AND OUTPUT COLUMNS
# SITES is imported from lunar_sites.py.
TARGETS = [("Earth", "399"), ("Sun", "10")]

CSV_HEADER = [
    "region", "utc",
    "site_from_earth_x_km", "site_from_earth_y_km", "site_from_earth_z_km",
    "earth_zenith_deg",
    "site_from_sun_x_km", "site_from_sun_y_km", "site_from_sun_z_km",
    "solar_zenith_deg",
    "earth_azimuth_deg", "sun_azimuth_deg",
]


# 4. ASK JPL FOR ONE TABLE
# Data rows lie between $$SOE and $$EOE.
def get_table(settings):
    parameters = {"format": "text"}

    for name, value in settings.items():
        parameters[name] = "'" + value + "'"

    url = "https://ssd.jpl.nasa.gov/api/horizons.api?"
    url += urllib.parse.urlencode(parameters)

    with urllib.request.urlopen(url, timeout=180) as response:
        text = response.read().decode("utf-8")

    if "$$SOE" not in text or "$$EOE" not in text:
        raise ValueError("JPL could not make the table:\n" + text[-1500:])

    if "Center body name: Moon (301)" not in text:
        raise ValueError("The observing body must be the Moon.")

    target_name = "Earth" if settings["COMMAND"] == "399" else "Sun"

    if f"Target body name: {target_name} ({settings['COMMAND']})" not in text:
        raise ValueError("JPL returned the wrong target.")

    if settings["EPHEM_TYPE"] == "VECTORS":
        if (
            "GEOMETRIC cartesian states" not in text
            or "Reference frame : ICRF" not in text
        ):
            raise ValueError("Expected geometric XYZ in ICRF axes.")

    header_text, data_text = text.split("$$SOE", 1)
    data_text = data_text.split("$$EOE", 1)[0]

    header = []
    for line in header_text.splitlines():
        if "Date__(UT)" in line or "Calendar Date" in line:
            header = [name.strip() for name in next(csv.reader([line]))]

    rows = list(csv.reader(data_text.strip().splitlines()))
    return header, rows


# 5. READ JPL'S DATE FORMAT
def read_time(value):
    date_text, time_text = value.strip().removeprefix("A.D. ").split()
    year, month, day = date_text.split("-")

    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    clock = time_text.split(":")
    seconds = float(clock[2]) if len(clock) == 3 else 0

    date = datetime(
        int(year),
        months.index(month) + 1,
        int(day),
        int(clock[0]),
        int(clock[1]),
    )

    return date + timedelta(seconds=seconds)


# 6. DOWNLOAD AND CALCULATE THE RESULTS
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
            # Shared settings for this body and lunar observing point.
            settings = {
                "COMMAND": body_code,
                "CENTER": "coord@301",
                "COORD_TYPE": "GEODETIC",
                "SITE_COORD": f"{longitude},{latitude},{HEIGHT_KM}",
                "START_TIME": START_TIME,
                "STOP_TIME": STOP_TIME,
                "STEP_SIZE": f"{STEP_MINUTES} min",
                "TIME_TYPE": "UT",
                "CAL_TYPE": "GREGORIAN",
                "CSV_FORMAT": "YES",
                "MAKE_EPHEM": "YES",
                "OBJ_DATA": "NO",
            }

            # First request: azimuth and elevation.
            observer_settings = settings.copy()
            observer_settings.update({
                "EPHEM_TYPE": "OBSERVER",
                "QUANTITIES": "4",
                "APPARENT": "AIRLESS",
                "TIME_DIGITS": "MINUTES",
                "CAL_FORMAT": "CAL",
                "ELEV_CUT": "-90",
                "SKIP_DAYLT": "NO",
            })

            observer_header, observer_rows = get_table(observer_settings)

            elevation_column = observer_header.index("Elev_(a-app)")
            azimuth_column = observer_header.index("Azi_(a-app)")

            # Second request: geometric XYZ in fixed ICRF axes, in km.
            vector_settings = settings.copy()
            vector_settings.update({
                "EPHEM_TYPE": "VECTORS",
                "VEC_TABLE": "1",
                "REF_SYSTEM": "ICRF",
                "REF_PLANE": "FRAME",
                "VEC_CORR": "NONE",
                "OUT_UNITS": "KM-S",
            })

            vector_header, vector_rows = get_table(vector_settings)

            x_column = vector_header.index("X")
            y_column = vector_header.index("Y")
            z_column = vector_header.index("Z")

            if (
                len(observer_rows) != number_of_times
                or len(vector_rows) != number_of_times
            ):
                raise ValueError("JPL returned an unexpected number of readings.")

            body_results = []

            for index, (observer, vector) in enumerate(
                zip(observer_rows, vector_rows)
            ):
                expected_time = start + index * interval
                observer_time = read_time(observer[0])
                vector_time = read_time(vector[1])

                if (
                    observer_time != expected_time
                    or vector_time != expected_time
                ):
                    raise ValueError(
                        "The observer and vector times do not match the settings."
                    )

                # Reverse the vector to point from the body's centre to the site.
                x = -float(vector[x_column])
                y = -float(vector[y_column])
                z = -float(vector[z_column])

                zenith = round(90.0 - float(observer[elevation_column]), 6)

                # Azimuth is clockwise from local north.
                azimuth = float(observer[azimuth_column])

                if not math.isfinite(azimuth) or not 0 <= azimuth <= 360:
                    raise ValueError("An azimuth angle is invalid.")

                azimuth = azimuth % 360  # Express north as 0 degrees.

                if (
                    not all(math.isfinite(n) for n in [x, y, z, zenith])
                    or not 0 <= zenith <= 180
                ):
                    raise ValueError("An XYZ value or zenith angle is invalid.")

                body_results.append([x, y, z, zenith, azimuth])

            results[body_name] = body_results
            print(" ", body_name, "readings:", len(body_results), flush=True)

        # Match Earth and Sun results at each timestamp.
        site_rows = []

        for index in range(number_of_times):
            utc = (start + index * interval).isoformat(timespec="seconds") + "Z"

            earth = results["Earth"][index]
            sun = results["Sun"][index]

            # Preserve the original columns, then append the two azimuths.
            row = (
                [site_name, utc]
                + earth[:4]
                + sun[:4]
                + [earth[4], sun[4]]
            )

            site_rows.append(row)

        combined_rows += site_rows

        file_name = site_name.lower().replace(" ", "_") + ".csv"

        with (OUTPUT_FOLDER / file_name).open(
            "w", newline="", encoding="utf-8"
        ) as file:
            writer = csv.writer(file)
            writer.writerow(CSV_HEADER)
            writer.writerows(site_rows)

    # Save the combined table after all sites succeed.
    temporary = OUTPUT_FOLDER / "combined.csv.part"

    with temporary.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(CSV_HEADER)
        writer.writerows(combined_rows)

    temporary.replace(OUTPUT_FOLDER / "combined.csv")
    print("Finished. Open combined.csv in:", OUTPUT_FOLDER.resolve())


# 7. START THE SCRIPT
if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(f"Stopped: {error}")
