# SELENE lunar visibility backend

The backend returns the apparent direction of the Sun and Earth from a chosen
lunar surface point. It reuses the existing JPL Horizons HTTP GET client. The
frontend can call these endpoints without running the annual CSV export.

## Start the API

Use Python 3.10 or later. Open a terminal in the repository root (the folder
containing `requirements.txt`). A virtual environment is recommended:

```sh
python -m venv .venv
```

Activate it in Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Or on macOS/Linux:

```sh
source .venv/bin/activate
```

Install dependencies and start the server:

```sh
python -m pip install -r requirements.txt
python -m uvicorn src.Ephemeris.api:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/docs> to try the endpoints in your browser. This starts
a local backend; it does not publish it or change any frontend files.

| Method | Local URL | Purpose |
| --- | --- | --- |
| GET | `http://127.0.0.1:8000/api/sites` | The nine presets from `lunar_sites.py` |
| POST | `http://127.0.0.1:8000/api/visibility` | Sun/Earth directions for a selected lunar point |

## Request and response

Send this JSON to `/api/visibility`:

```json
{
  "latitude": -85.99,
  "longitude": -0.125,
  "landingTimeUtc": "2026-11-14T12:00:00Z"
}
```

For example, in Windows PowerShell:

```powershell
$body = @{
    latitude = -85.99
    longitude = -0.125
    landingTimeUtc = "2026-11-14T12:00:00Z"
} | ConvertTo-Json
$result = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/api/visibility" -ContentType "application/json" -Body $body
$result.samples[0]
```

Or use curl on macOS/Linux:

```sh
curl -X POST http://127.0.0.1:8000/api/visibility \
  -H 'Content-Type: application/json' \
  -d '{"latitude":-85.99,"longitude":-0.125,"landingTimeUtc":"2026-11-14T12:00:00Z"}'
```

The response has this shape. These angles are illustrative; the real response
contains **289 samples**, every 15 minutes from landing through +72 hours,
including both endpoints:

```json
{
  "landingTimeUtc": "2026-11-14T12:00:00Z",
  "stepMinutes": 15,
  "samples": [
    {
      "utc": "2026-11-14T12:00:00Z",
      "sun": {"azimuthDeg": 135.5, "elevationDeg": 11.4},
      "earth": {"azimuthDeg": 222.5, "elevationDeg": -2.4}
    }
  ]
}
```

The API accepts arbitrary coordinates, including points outside the presets.
Latitude is north-positive, in [-90, 90]. Longitude is east-positive, in
[-180, 180]. Both must be finite JSON numbers, not strings or booleans. The
UTC timestamp must end in `Z` or `+00:00` and fall on a whole minute.
JavaScript's `2026-11-14T12:00:00.000Z` is accepted and normalized to the
form without milliseconds. Nonzero seconds/fractional seconds are rejected.

`GET /api/sites` returns objects in this format:

```json
{"name": "Malapert Massif", "latitude": -85.99, "longitude": -0.125}
```

## What the calculations mean

Each request makes two Horizons calls: one observer table for Sun (10) and one
for Earth (399), both with quantity 4 (azimuth/elevation). Both calls use the
requested UTC window and a lunar geodetic observer (`coord@301`). The site is
sent to JPL as **longitude, latitude, height**, with height **0 km above JPL's
lunar reference surface**. Preset coordinates are representative points;
edit `lunar_sites.py` to change them. Actual terrain height and slope are not
included in this API.

Azimuth is measured clockwise from local north: north = 0 degrees, east = 90,
south = 180, west = 270. Output is in [0, 360). Elevation is measured above the
local reference horizontal, in [-90, 90]; negative elevations remain negative.
The directions are **airless apparent directions**, including Horizons'
apparent-position corrections without atmospheric refraction. Zenith angle
in degrees is `90 - elevationDeg`. Azimuth is undefined at the zenith/nadir
or an exact geographic pole; avoid those singular cases when interpreting it.

A positive Earth elevation alone does not establish a usable ground station
link. That also requires station geometry and visibility, antennas, link
budget, and other mission constraints. Local ridges/craters and terrain
shadows are not modeled; these are reference-horizon directions, not a
terrain-aware lighting or communication-access guarantee.

The backend checks both targets, the Moon as the observer body, all 289
timestamps for each body, finite angles, and their ranges. It pairs the
readings by UTC and rejects missing, duplicate, or unexpected rows. The API
performs no ICRF vector requests and writes no CSV files.

## Errors and waiting time

| HTTP status | Meaning |
| --- | --- |
| 422 | Invalid coordinates or timestamp; Horizons is not contacted |
| 502 | Horizons could not be reached or returned incomplete/invalid data |
| 504 | Horizons took too long; retry the request |

Errors use a short JSON `detail` field. Raw Horizons responses and tracebacks
are not sent to clients. Each upstream socket operation has a maximum
30-second timeout, the calculation checks a 60-second time budget, and the API
stops waiting after 65 seconds overall. A timed-out worker cannot be forcibly
interrupted by Python; pending socket work finishes under its own timeout.
There is no local ephemeris fallback or result cache.

## Connect a separate React development server

For React served at `http://127.0.0.1:4173`, set the allowed origin **before**
starting the API. In Windows PowerShell:

```powershell
$env:SELENE_CORS_ORIGINS = "http://127.0.0.1:4173"
python -m uvicorn src.Ephemeris.api:app --host 127.0.0.1 --port 8000
```

On macOS/Linux:

```sh
SELENE_CORS_ORIGINS=http://127.0.0.1:4173 python -m uvicorn src.Ephemeris.api:app --host 127.0.0.1 --port 8000
```

The frontend should call `http://127.0.0.1:8000/api/visibility` and
`http://127.0.0.1:8000/api/sites`. The origin must match exactly; `localhost`
and `127.0.0.1` are different origins. Multiple allowed origins can be separated
by commas. With no setting, cross-origin access is disabled; a same-origin
development proxy is also compatible. Frontend wiring is separate work.

## Keep using the CSV script

```sh
python src/Ephemeris/Position_and_zenith_compilation.py
```

This still runs the original batch export, using its editable date, step, and
output-folder settings and the sites imported from `lunar_sites.py`. Its
original ten columns stay in their original order. The previously requested
`earth_azimuth_deg` and `sun_azimuth_deg` columns are appended at the end.
XYZ remains in kilometres with ICRF axes, pointing **from each body centre to
the lunar site**. Zenith remains `90 - apparent elevation`. The batch uses
four Horizons calls per site (two observer tables and two vector tables).
Unlike the API, the batch saves one CSV per site and a combined CSV.

## Files and tests

- `api.py`: request validation, API endpoints, response models, and CORS.
- `Position_and_zenith_compilation.py`: shared GET client, observer parsing,
  reusable `calculate_visibility(...)`, and the existing CSV entry point.
- `lunar_sites.py`: the editable preset list; it imports nothing from the API.
- `tests/test_visibility.py`: offline tests with mocked Horizons HTTP responses.

From the repository root:

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Tests cover the full response, arbitrary/boundary coordinates, UTC validation
before upstream calls, all nine presets, errors/timeouts, missing/malformed
rows, CORS, no API CSV output, and the batch schema and vector direction.
