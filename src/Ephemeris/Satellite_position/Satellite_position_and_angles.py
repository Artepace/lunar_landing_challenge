"""Download real satellite orbits and calculate directions from lunar sites.

Run: python src/Ephemeris/Satellite_position_and_angles.py
Edit satellite_settings.py and lunar_sites.py, rather than this calculation file.
"""

import csv
import http.client
import json
import math
import platform
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import skyfield
from skyfield.api import EarthSatellite, Loader, PlanetaryConstants
from skyfield.framelib import itrs

if __package__:
    from .lunar_sites import SITES
    from . import satellite_settings as settings
else:
    from lunar_sites import SITES
    import satellite_settings as settings


# 1. CONSTANTS AND OUTPUT COLUMNS
# XYZ is a geometric vector FROM THE LUNAR SITE TO THE SATELLITE, in km.
# Its axes are ICRF-aligned, like the axes in the earlier Earth/Sun export.
# Azimuth and zenith are airless apparent angles, like the earlier angles.
CSV_HEADER = [
    "region", "utc", "satellite_catalog_id", "satellite_name",
    "satellite_from_site_x_km", "satellite_from_site_y_km",
    "satellite_from_site_z_km", "satellite_azimuth_deg", "satellite_zenith_deg",
    "geometric_access",
]
WINDOW_HEADER = [
    "region", "satellite_catalog_id", "satellite_name", "start_utc", "stop_utc",
    "sampled_duration_seconds", "start_clipped_to_run", "stop_clipped_to_run",
]
COVERAGE_HEADER = [
    "region", "start_utc", "stop_utc", "sampled_duration_seconds",
    "start_clipped_to_run", "stop_clipped_to_run",
]
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php"
CACHE_SECONDS = 2 * 60 * 60
HTTP_TIMEOUT_SECONDS = 60
MAX_SAMPLES = 2_000_000
EARTH_RADII_KM = np.array([6378.137, 6378.137, 6356.752314245])  # WGS84.
KERNEL_NAMES = ["de421.bsp", "moon_080317.tf", "pck00008.tpc",
                "moon_pa_de421_1900-2050.bpc"]


class SatelliteDataError(RuntimeError):
    """A download or an orbit calculation could not be completed."""


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        # Stop on a changed API address instead of repeatedly following errors.
        return None


def utc_text(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def get_bytes(url):
    """This is the HTTP GET request. There are no automatic retry loops."""
    request = urllib.request.Request(url, headers={"User-Agent": "KHONSU-lunar-satellite-study/1.0"})
    try:
        opener = urllib.request.build_opener(NoRedirects())
        with opener.open(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise SatelliteDataError(f"Download returned HTTP {response.status}.")
            return response.read()
    except urllib.error.HTTPError as error:
        raise SatelliteDataError(f"Download returned HTTP {error.code}; queries stopped: {url}") from error
    except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
        raise SatelliteDataError(f"Could not download {url}: {error}") from error


def save_bytes(path, data):
    """Finish the download before publishing a cache file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(data)
    temporary.replace(path)


# 2. GET ONE ORBIT PER SATELLITE, NOT ONE ORBIT PER LUNAR SITE
def read_orbit(data, catalog_id):
    """Read CelesTrak JSON and ensure it describes the requested object."""
    try:
        records = json.loads(data)
        if not isinstance(records, list) or len(records) != 1:
            raise ValueError("Expected one object.")
        record = records[0]
        if (int(record["NORAD_CAT_ID"]) != catalog_id
                or not isinstance(record["OBJECT_NAME"], str) or not record["OBJECT_NAME"]):
            raise ValueError("Wrong satellite.")
        limits = {"MEAN_MOTION": (0, math.inf), "ECCENTRICITY": (0, 1),
                  "INCLINATION": (0, 180), "RA_OF_ASC_NODE": (0, 360),
                  "ARG_OF_PERICENTER": (0, 360), "MEAN_ANOMALY": (0, 360)}
        for field, (low, high) in limits.items():
            number = float(record[field])
            if not math.isfinite(number) or not low <= number <= high:
                raise ValueError(f"Invalid {field}.")
            if field == "ECCENTRICITY" and number == 1:
                raise ValueError("An elliptical orbit is required.")
            if field == "MEAN_MOTION" and number == 0:
                raise ValueError("Mean motion must be positive.")
        for field in ("BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"):
            if not math.isfinite(float(record[field])):
                raise ValueError(f"Invalid {field}.")
        if (not isinstance(record["CLASSIFICATION_TYPE"], str)
                or len(record["CLASSIFICATION_TYPE"]) != 1
                or not isinstance(record["OBJECT_ID"], str)):
            raise ValueError("Invalid orbit identification fields.")
        for field in ("EPHEMERIS_TYPE", "ELEMENT_SET_NO", "REV_AT_EPOCH"):
            if int(record[field]) < 0:
                raise ValueError(f"Invalid {field}.")
        # OMM epochs are UTC. CelesTrak normally omits the redundant UTC suffix.
        epoch = datetime.fromisoformat(record["EPOCH"].replace("Z", "+00:00"))
        if epoch.tzinfo is not None and epoch.utcoffset() != timedelta(0):
            raise ValueError("The orbital epoch must be UTC.")
        for field, expected in (("CENTER_NAME", "EARTH"), ("REF_FRAME", "TEME"),
                                ("TIME_SYSTEM", "UTC"), ("MEAN_ELEMENT_THEORY", "SGP4")):
            if record.get(field, expected) != expected:
                raise ValueError(f"Unsupported {field}.")
        record["EPOCH"] = epoch.replace(tzinfo=None).isoformat(timespec="microseconds")
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, UnicodeError) as error:
        raise SatelliteDataError(f"Invalid orbital data for catalogue {catalog_id}.") from error
    return record


def download_orbit(catalog_id, cache_folder, now=None):
    if type(catalog_id) is not int or not 1 <= catalog_id <= 999_999_999:
        raise ValueError("Satellite IDs must be positive catalogue integers of up to 9 digits.")
    now = now or datetime.now(timezone.utc)
    path = Path(cache_folder) / "orbits" / f"{catalog_id}.json"
    if path.exists() and 0 <= now.timestamp() - path.stat().st_mtime < CACHE_SECONDS:
        data = path.read_bytes()
    else:
        url = CELESTRAK_URL + "?" + urllib.parse.urlencode({"CATNR": catalog_id, "FORMAT": "JSON"})
        data = get_bytes(url)
        read_orbit(data, catalog_id)  # Never cache an error page as an orbit.
        save_bytes(path, data)
    return read_orbit(data, catalog_id), data


# 3. BUILD THE TIME GRID AND CHECK SETTINGS BEFORE DOWNLOADING
def make_times(start_text, duration_hours, step_seconds, now=None):
    if type(step_seconds) is not int or step_seconds <= 0:
        raise ValueError("STEP_SECONDS must be a positive whole number.")
    if (isinstance(duration_hours, bool) or not isinstance(duration_hours, (int, float))
            or not math.isfinite(duration_hours) or duration_hours <= 0):
        raise ValueError("DURATION_HOURS must be positive and finite.")
    total = duration_hours * 3600
    if not float(total).is_integer() or int(total) % step_seconds:
        raise ValueError("The duration in seconds must be an exact multiple of STEP_SECONDS.")
    if start_text is None:
        start = (now or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    else:
        start = datetime.strptime(start_text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    count = int(total) // step_seconds + 1
    if count > MAX_SAMPLES:
        raise ValueError("Too many readings. Use a larger time step or a shorter duration.")
    return [start + timedelta(seconds=index * step_seconds) for index in range(count)]


def choose_sites(names):
    if names is None:
        selected = list(SITES)
    else:
        if not isinstance(names, list) or not names or len(set(names)) != len(names):
            raise ValueError("SITE_NAMES must be None or a list of unique site names.")
        by_name = {name: (name, longitude, latitude) for name, longitude, latitude in SITES}
        if any(name not in by_name for name in names):
            raise ValueError("A site name does not match lunar_sites.py.")
        selected = [by_name[name] for name in names]
    for name, longitude, latitude in selected:
        if (not isinstance(name, str) or not name or not math.isfinite(longitude)
                or not math.isfinite(latitude) or not -180 <= longitude <= 180
                or not -90 < latitude < 90):
            raise ValueError("Sites need valid coordinates away from the exact poles (undefined north).")
    if not selected:
        raise ValueError("Choose at least one lunar site.")
    return selected


def check_epoch(satellite, timestamps, max_days):
    epoch = satellite.epoch.utc_datetime()
    farthest = max(abs((timestamps[0] - epoch).total_seconds()),
                   abs((timestamps[-1] - epoch).total_seconds())) / 86400
    if farthest > max_days:
        raise SatelliteDataError(
            f"{satellite.name}: the requested window is {farthest:.1f} days from its "
            f"orbital epoch ({utc_text(epoch)}), beyond the {max_days:g}-day screening limit. "
            "Choose nearby dates or obtain orbital elements for the intended dates.")
    return epoch, farthest


# 4. LOAD JPL'S MOON POSITION AND ORIENTATION FILES ONCE
class LunarModel:
    """Skyfield combines JPL ephemerides, lunar rotation, and SGP4 frames."""

    def __init__(self, cache_folder):
        self.loader = Loader(str(Path(cache_folder) / "jpl"), verbose=False)
        for name in KERNEL_NAMES:
            path = Path(self.loader.path_to(name))
            if not path.exists():
                print("Downloading JPL reference file:", name, flush=True)
                save_bytes(path, get_bytes(self.loader.build_url(name)))
        self.timescale = self.loader.timescale(builtin=True)
        self.ephemeris = self.loader("de421.bsp")
        self.constants = PlanetaryConstants()
        for name in ("moon_080317.tf", "pck00008.tpc"):
            with open(self.loader.path_to(name), "rb") as stream:
                self.constants.read_text(stream)
        self.orientation_file = open(self.loader.path_to("moon_pa_de421_1900-2050.bpc"), "rb")
        self.constants.read_binary(self.orientation_file)
        self.frame = self.constants.build_frame_named("MOON_ME_DE421")
        self.earth = self.ephemeris["earth"]
        self.moon = self.ephemeris["moon"]

    def close(self):
        self.ephemeris.close()
        self.orientation_file.close()


# 5. TEST THE FINITE LINE SEGMENT AGAINST EARTH'S WGS84 ELLIPSOID
def segment_hits_ellipsoid(start_xyz, stop_xyz, radii=EARTH_RADII_KM):
    """Inputs have shape (3, number_of_times), in Earth-fixed km."""
    start = np.asarray(start_xyz, dtype=float) / np.asarray(radii)[:, None]
    stop = np.asarray(stop_xyz, dtype=float) / np.asarray(radii)[:, None]
    direction = stop - start
    length_squared = np.sum(direction * direction, axis=0)
    if np.any(length_squared == 0):
        raise SatelliteDataError("A line segment has zero length.")
    fraction = np.clip(-np.sum(start * direction, axis=0) / length_squared, 0, 1)
    nearest = start + fraction * direction
    return np.sum(nearest * nearest, axis=0) <= 1.0


def calculate_pair(model, satellite, site, timestamps, height_km=0.0, min_elevation_deg=0.0):
    """Return XYZ, apparent angles, and geometric access for one site/satellite."""
    name, longitude, latitude = site
    times = model.timescale.from_datetimes(timestamps)
    surface = model.constants.build_latlon_degrees(
        model.frame, latitude, longitude, elevation_m=height_km * 1000)
    observer = model.moon + surface
    target = model.earth + satellite

    # SGP4 starts in TEME. Skyfield transforms that state before combining it
    # with JPL's vectors. Never subtract a raw TEME vector from an ICRF vector.
    satellite_state = satellite.at(times)
    if any(message is not None for message in np.atleast_1d(satellite_state.message)):
        raise SatelliteDataError(f"SGP4 could not propagate {satellite.name} for every timestamp.")
    site_from_earth = (observer - model.earth).at(times).position.km
    satellite_from_earth = satellite_state.position.km
    xyz = satellite_from_earth - site_from_earth

    # Like the earlier export, XYZ is simultaneous/geometric, while angles
    # include light-travel time and apparent-direction corrections. This
    # matters for a lunar observer: the satellite moves during the light time.
    apparent = observer.at(times).observe(target).apparent()
    elevation, azimuth, _ = apparent.altaz()  # No atmospheric refraction.
    zenith = 90.0 - elevation.degrees

    # Access uses geometric rays. Rotate to Earth-fixed coordinates before
    # using the ellipsoid, and test the segment, not an infinite line.
    rotation = itrs.rotation_at(times)
    site_fixed = np.einsum("ijt,jt->it", rotation, site_from_earth)
    satellite_fixed = np.einsum("ijt,jt->it", rotation, satellite_from_earth)
    earth_blocked = segment_hits_ellipsoid(site_fixed, satellite_fixed)
    geometric_elevation, _, _ = (target - observer).at(times).altaz()
    access = (geometric_elevation.degrees >= min_elevation_deg) & ~earth_blocked

    values = np.vstack((xyz, azimuth.degrees, zenith))
    if (not np.all(np.isfinite(values)) or np.any(zenith < 0) or np.any(zenith > 180)):
        raise SatelliteDataError(f"Invalid positions or angles for {name} / {satellite.name}.")
    return {"xyz": xyz, "azimuth": azimuth.degrees % 360, "zenith": zenith, "access": access}


# 6. TURN THE SAMPLED ACCESS FLAGS INTO APPROXIMATE WINDOWS
def access_windows(timestamps, flags):
    """A state change is assigned to its first sample, not interpolated.

    Boundaries have the chosen sampling resolution; shorter events can be
    missed. True at the last timestamp contributes no extra time past it.
    """
    if len(timestamps) != len(flags) or not timestamps:
        raise ValueError("Access flags must match a nonempty time grid.")
    windows = []
    beginning = None
    for index, flag in enumerate(flags):
        if flag and beginning is None:
            beginning = index
        if beginning is not None and (not flag or index == len(flags) - 1):
            stop = timestamps[index]
            start = timestamps[beginning]
            if stop > start:
                windows.append({"start": start, "stop": stop,
                                "seconds": (stop - start).total_seconds(),
                                "start_clipped": beginning == 0,
                                "stop_clipped": bool(flag and index == len(flags) - 1)})
            beginning = None
    return windows


def window_cells(window):
    return [utc_text(window["start"]), utc_text(window["stop"]), window["seconds"],
            window["start_clipped"], window["stop_clipped"]]


# 7. RUN THE DOWNLOADS AND WRITE THE OUTPUT FILES
def main():
    timestamps = make_times(settings.START_TIME, settings.DURATION_HOURS, settings.STEP_SECONDS)
    sites = choose_sites(settings.SITE_NAMES)
    ids = settings.SATELLITE_IDS
    if (not isinstance(ids, list) or not ids or any(type(i) is not int or not 1 <= i <= 999_999_999 for i in ids)
            or len(set(ids)) != len(ids)):
        raise ValueError("SATELLITE_IDS must be a nonempty list of unique catalogue integers.")
    if len(timestamps) * len(sites) * len(ids) > MAX_SAMPLES:
        raise ValueError("Too many readings: reduce sites/satellites/duration or increase STEP_SECONDS.")
    if (not math.isfinite(settings.HEIGHT_KM) or settings.HEIGHT_KM < 0
            or not math.isfinite(settings.MIN_ELEVATION_DEG)
            or not 0 <= settings.MIN_ELEVATION_DEG < 90
            or not math.isfinite(settings.MAX_EPOCH_DISTANCE_DAYS)
            or not 0 < settings.MAX_EPOCH_DISTANCE_DAYS <= 14):
        raise ValueError("Check height, elevation, and epoch-distance settings (maximum 14 days).")

    records = []
    for catalog_id in ids:
        print("Loading CelesTrak orbit:", catalog_id, flush=True)
        record, raw = download_orbit(catalog_id, settings.CACHE_FOLDER)
        records.append((catalog_id, record, raw))
    model = LunarModel(settings.CACHE_FOLDER)
    try:
        satellites = []
        for catalog_id, record, raw in records:
            try:
                satellite = EarthSatellite.from_omm(model.timescale, record)
            except (ValueError, TypeError, KeyError, OverflowError) as error:
                raise SatelliteDataError(f"Could not load SGP4 elements for {catalog_id}.") from error
            epoch, age = check_epoch(satellite, timestamps, settings.MAX_EPOCH_DISTANCE_DAYS)
            satellites.append((catalog_id, satellite, raw, epoch, age))

        # Each run gets its own directory, so an older CSV open in Excel does
        # not block this run from saving a new combined.csv.
        run_id = datetime.now(timezone.utc).strftime("run_%Y%m%d_%H%M%S_%f")
        output = Path(settings.OUTPUT_FOLDER) / run_id
        output.mkdir(parents=True, exist_ok=False)
        (output / "orbital_data").mkdir()
        print("Saving results to:", output.resolve(), flush=True)
        metadata = {"status": "running", "start_utc": utc_text(timestamps[0]),
                    "stop_utc": utc_text(timestamps[-1]), "step_seconds": settings.STEP_SECONDS,
                    "samples_per_site_satellite": len(timestamps), "sites": sites,
                    "height_km": settings.HEIGHT_KM, "minimum_geometric_elevation_deg": settings.MIN_ELEVATION_DEG,
                    "vector_direction": "lunar_site_to_satellite", "xyz_axes": "ICRF-aligned",
                    "xyz_kind": "simultaneous geometric", "angles_kind": "airless apparent",
                    "lunar_frame": "MOON_ME_DE421", "earth_occluder": "WGS84 ellipsoid",
                    "python_version": platform.python_version(), "skyfield_version": skyfield.__version__,
                    "orbit_source": CELESTRAK_URL, "satellites": []}
        for catalog_id, satellite, raw, epoch, age in satellites:
            (output / "orbital_data" / f"{catalog_id}.json").write_bytes(raw)
            metadata["satellites"].append({"catalog_id": catalog_id, "name": satellite.name,
                                           "epoch_utc": utc_text(epoch), "maximum_epoch_distance_days": age})
        metadata_path = output / "run_metadata.json"
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

        # Only one site/satellite pair's large arrays are held at a time.
        with (output / "combined.csv").open("w", newline="", encoding="utf-8") as readings_file, \
             (output / "access_windows.csv").open("w", newline="", encoding="utf-8") as windows_file, \
             (output / "coverage_windows.csv").open("w", newline="", encoding="utf-8") as coverage_file:
            readings_writer, windows_writer, coverage_writer = map(csv.writer, (readings_file, windows_file, coverage_file))
            readings_writer.writerow(CSV_HEADER)
            windows_writer.writerow(WINDOW_HEADER)
            coverage_writer.writerow(COVERAGE_HEADER)
            for site in sites:
                any_satellite = np.zeros(len(timestamps), dtype=bool)
                for catalog_id, satellite, raw, epoch, age in satellites:
                    print("Calculating:", site[0], "/", satellite.name, flush=True)
                    result = calculate_pair(model, satellite, site, timestamps,
                                            settings.HEIGHT_KM, settings.MIN_ELEVATION_DEG)
                    any_satellite |= result["access"]
                    for index, stamp in enumerate(timestamps):
                        readings_writer.writerow([site[0], utc_text(stamp), catalog_id, satellite.name,
                            *[float(value) for value in result["xyz"][:, index]],
                            float(result["azimuth"][index]), float(result["zenith"][index]),
                            bool(result["access"][index])])
                    for window in access_windows(timestamps, result["access"]):
                        windows_writer.writerow([site[0], catalog_id, satellite.name, *window_cells(window)])
                for window in access_windows(timestamps, any_satellite):
                    coverage_writer.writerow([site[0], *window_cells(window)])
        metadata["status"] = "complete"
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        print("Finished. Open combined.csv in:", output.resolve())
        return output
    finally:
        model.close()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, SatelliteDataError) as error:
        sys.exit(f"Stopped: {error}")
