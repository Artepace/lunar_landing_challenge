# Lunar-site directions to real Earth satellites

This is a **new script**. Keep the existing Sun/Earth compilation script and
`api.py`. The satellite script imports your existing `lunar_sites.py` and gets
real orbital elements from the CelesTrak HTTP API.

## Files to add

Put these files in `src/Ephemeris/`:

- `Satellite_position_and_angles.py` — the script to run.
- `satellite_settings.py` — the settings you edit.
- `SATELLITE_README.md` — these instructions.

Keep your existing `lunar_sites.py` alongside them. It supplies the lunar sites
in the same `(name, longitude, latitude)` format used by your previous script.
Put `requirements-satellites.txt` in the repository root. The ZIP includes a
copy of the original site list only for use if you do not already have it.

## Install and run

Use Python 3.10 or later. From the repository root:

```sh
python -m pip install -r requirements-satellites.txt
python src/Ephemeris/Satellite_position_and_angles.py
```

The console prints the full output folder path. Files go under
`data/satellite_results/run_<UTC date and time>/` in your repository. Each run
has a new folder, so a CSV open in Excel from a previous run does not block it.

First run also downloads about 19 MB of JPL reference data into
`data/satellite_cache/jpl/`. Later runs reuse those files. Do not upload either
the cache or result folders as source code. If needed, add these lines to
the repository's `.gitignore`:

```gitignore
/data/satellite_cache/
/data/satellite_results/
```

## Choose satellites and dates

Edit `satellite_settings.py`. For one satellite:

```python
SATELLITE_IDS = [25544]  # ISS, used as a geometry example.
```

For several satellites:

```python
SATELLITE_IDS = [25544, 20580]  # ISS and Hubble, both geometry examples.
```

Each number is a NORAD catalogue ID, not a JPL body code. You can look up
objects in [CelesTrak's satellite catalogue](https://celestrak.org/satcat/search.php).
Catalogue IDs select the actual published orbits: changing an inclination
locally would create a hypothetical orbit, rather than that real satellite.
The examples are not proposed lunar communication relays.

```python
START_TIME = None         # Start at the current UTC minute.
DURATION_HOURS = 24
STEP_SECONDS = 60
SITE_NAMES = None         # All sites in lunar_sites.py.
```

Or select one site and a specific nearby UTC time:

```python
START_TIME = "2026-11-15 12:00"
SITE_NAMES = ["Malapert Massif"]
```

That date is an example, not a permanently valid default. Both time endpoints
are included; 24 hours at 60-second steps gives 1,441 readings per site and
satellite. The duration must be an exact multiple of the step. Smaller steps
resolve short access periods better. A run is limited to two million readings
to avoid accidentally creating an enormous file.

**Use dates near the downloaded orbit's epoch.** Current elements cannot
reliably predict an entire year or reconstruct a distant historical orbit.
The default screening limit is seven days from the element epoch, checked
at both ends of the requested window. Even a much shorter prediction can
be inaccurate after a maneuver. The limit is not an accuracy guarantee.
Historical dates require appropriate historical elements; this version
queries CelesTrak's current-data endpoint.

## What the CSV contains

`combined.csv` has one row per lunar site, satellite, and UTC timestamp:

| Column | Meaning |
| --- | --- |
| `region` | Name from `lunar_sites.py` |
| `utc` | UTC timestamp |
| `satellite_catalog_id` | NORAD catalogue ID |
| `satellite_name` | Object name supplied by CelesTrak |
| `satellite_from_site_x_km` | Signed X component, kilometres |
| `satellite_from_site_y_km` | Signed Y component, kilometres |
| `satellite_from_site_z_km` | Signed Z component, kilometres |
| `satellite_azimuth_deg` | Apparent bearing clockwise from local lunar north, [0, 360) |
| `satellite_zenith_deg` | Apparent angle from local upward direction, [0, 180] |
| `geometric_access` | Above the chosen geometric elevation and not blocked by Earth |

**The vector points from the lunar site to the satellite.** It has three
components rather than one distance column. Its axes are ICRF-aligned,
not local east/north/up axes. X, Y, and Z can be negative. If you need the
reverse direction, from the satellite centre to the lunar site as in the
older `site_from_earth_*` convention, negate all three components.

Like your earlier export, XYZ is the simultaneous geometric position
difference, while the angles are airless apparent directions. The angle
calculation includes the satellite's movement during light travel to the
Moon and apparent-direction corrections. No atmospheric refraction is
applied. Consequently the apparent angles are not obtained by simply
rotating the simultaneous XYZ vector. Elevation can be recovered as
`90 - satellite_zenith_deg`; a zenith greater than 90 means below the
reference horizon.

## Access and constellation coverage

- `access_windows.csv` lists approximate geometric access periods per
  site and satellite.
- `coverage_windows.csv` lists periods when **at least one** selected
  satellite has geometric access from each site. Overlapping access is
  counted once, rather than summed twice.
- `run_metadata.json` records the settings, orbital epochs, reference frames,
  software version, and completion status. Use runs whose status is `complete`.
- `orbital_data/<catalogue ID>.json` preserves the actual downloaded elements
  used for that run, so its inputs remain available after the cache updates.

Access uses a straight **finite line segment** from site to satellite and
Earth's WGS84 ellipsoid, plus the lunar site's geometric elevation. The
Moon is modeled with a spherical reference surface and JPL's DE421 mean-Earth
orientation (`MOON_ME_DE421`), including lunar libration. Height defaults to
0 km above that surface; terrain, crater rims, local slopes, diffraction,
antennas, transmitters, frequencies, and link budget are not included.
Geometric access therefore does not establish a usable communications link.

Access boundaries are assigned to the first sample showing a changed state.
They are **sampled estimates**, not precisely solved rise/set times; short
events between samples can be missed. With the default step, boundaries have
60-second resolution. `sampled_duration_seconds` is the difference between
the reported boundaries. Clipping flags indicate an access interval already
underway at the start of the run, or still underway at its end.

## How the API and mathematics work

For each unique catalogue ID, the script sends an HTTP GET request such as
`https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON`. The response
contains orbital elements, not a stream of XYZ positions. Downloads are
cached for two hours, so adding lunar sites does not cause more orbit queries.
Requests stop on an HTTP failure and are not automatically retried. Skyfield
uses SGP4 to propagate the elements, transforms their original TEME frame,
and combines them with JPL's Earth/Moon positions and lunar orientation.
Reference files are downloaded once and then reused. It does not ask JPL
Horizons for every satellite/sample.

Mathematically, at time t the geometric vector is **satellite position minus
lunar-site position**, with both positions expressed in common axes and at
the same instant. Its three components become the X, Y, and Z columns. For
the angle columns, the target is instead evaluated at the retarded emission
time, corrected to an apparent direction, and rotated into the site's local
north/east/up frame. Azimuth is atan2(east, north), wrapped into [0, 360),
and zenith is arccos(up divided by the vector magnitude). For geometric
occultation, the endpoints are rotated to Earth's fixed frame and scaled
by its ellipsoid radii. The code finds the nearest point to Earth's centre
along the finite segment; a scaled squared distance no greater than one
means Earth blocks the segment.

## Verification and sources

Run the satellite-only offline tests from the repository root:

```sh
python -m unittest discover -s tests -p test_satellite_positions.py -v
```

The tests cover API caching and failures, modern catalogue numbers, invalid
orbits, UTC grids, stale epochs, preset order, physical SGP4 propagation,
finite-segment intersection, Earth flattening, constellation access unions,
and the three separate XYZ output columns.

A live check used ISS data downloaded from CelesTrak on 2026-11-15. It produced
12,969 readings (nine sites, 1,441 timestamps each). At two timestamps for
Malapert Massif, independent Horizons requests using a TLE exported from the
same orbit agreed within 5.3 metres per XYZ component and 0.00001 degrees in
azimuth/zenith. That comparison validates the implementation, not the absolute
accuracy of the underlying satellite orbit. Details are in the included
`satellite_validation.json`.

- [CelesTrak JSON queries](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
- [CelesTrak usage policy](https://celestrak.org/usage-policy.php)
- [Skyfield satellite propagation](https://rhodesmill.org/skyfield/earth-satellites.html)
- [Skyfield lunar reference frames](https://rhodesmill.org/skyfield/planetary.html)
