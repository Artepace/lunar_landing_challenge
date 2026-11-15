# SELENE backend integration

Implement the Python side of the landing site visibility API. Work in the team's backend branch. Keep changes to the Python backend, its dependencies, tests, and run instructions. The frontend teammate will connect React separately.

## Starting point

- [Position_and_zenith_compilation.py](https://github.com/Artepace/lunar_landing_challenge/blob/8e6bb190172d0f53e422cef34f8863054c8db5fe/src/Ephemeris/Position_and_zenith_compilation.py) queries JPL Horizons and exports CSVs for every site and timestamp. Reuse its existing Horizons client and table parsing.
- [lunar_sites.py](https://github.com/Artepace/lunar_landing_challenge/blob/8e6bb190172d0f53e422cef34f8863054c8db5fe/src/Ephemeris/lunar_sites.py) defines nine presets as `(name, east_longitude_deg, latitude_deg)`.

## API contract

Implement `POST /api/visibility` in a separate module such as `src/Ephemeris/api.py`. Use the repository's existing Python web framework if present. Otherwise use FastAPI.

Request body:

```json
{
  "latitude": -85.99,
  "longitude": -0.125,
  "landingTimeUtc": "2026-11-14T12:00:00Z"
}
```

Latitude is north-positive in decimal degrees, from −90 to 90. Longitude is east-positive in decimal degrees, from −180 to 180. Accept arbitrary valid coordinates. Require finite numbers and an ISO 8601 UTC timestamp aligned to a whole minute. Accept the millisecond form emitted by JavaScript's `toISOString()` when seconds and milliseconds are zero. Reject invalid input with HTTP 422 before contacting Horizons.

Return a 72-hour series in ascending UTC order, sampled every 15 minutes, including the landing time and the +72-hour endpoint (289 samples). Keep the response field names below. The example shows only the first sample, with illustrative angles.

```json
{
  "landingTimeUtc": "2026-11-14T12:00:00Z",
  "stepMinutes": 15,
  "samples": [
    {
      "utc": "2026-11-14T12:00:00Z",
      "sun": { "azimuthDeg": 135.5, "elevationDeg": 11.4 },
      "earth": { "azimuthDeg": 222.5, "elevationDeg": 14.2 }
    }
  ]
}
```

Azimuth is measured clockwise from local north, in degrees from 0 to less than 360. Elevation is in degrees above the geometric local horizon, with negative values below it. Keep this distinction clear when documenting results: airless apparent directions are useful for the scene, and positive Earth elevation alone does not establish a usable ground station link.

Expose `GET /api/sites` from `lunar_sites.SITES`. Return a JSON array of objects with `name`, `latitude`, and `longitude` so the frontend can use the exact backend presets.

## Implementation

1. Extract reusable observer request construction and parsing in `Position_and_zenith_compilation.py`. Add a callable such as `calculate_visibility(latitude, longitude, start_utc, stop_utc, step_minutes)`. Use named arguments at the API boundary to reduce the risk of swapping latitude and longitude.
2. Query the Sun (10) and Earth (399) once each for the entire window using Horizons observer tables, quantity 4. Keep both azimuth and elevation. Use `coord@301` and serialize `SITE_COORD` as longitude, latitude, height in kilometres, with height zero. Check the returned target, row count, timestamps, and angle values. Pair the Sun and Earth readings by UTC and reject incomplete data.
3. Use the validated request values to construct the time window. Keep the API path independent of batch globals and CSV output. Keep the existing CSV command, columns, and vector direction working. The visibility route only needs observer angles, so it can skip the ICRF vector requests.
4. Bound upstream wait time. Map Horizons timeouts to HTTP 504 and upstream request or parsing failures to HTTP 502. Return a short JSON error without exposing a traceback or the raw upstream response.
5. Document the local launch command, dependency installation, and a sample request. If React will call the API directly from a separate origin in development, document how to allow `http://127.0.0.1:4173` through CORS. A same-origin development proxy is also compatible with this contract.

## Acceptance checks

- A valid request produces exactly 289 paired samples covering landing through +72 hours. The request uses the selected site, including its signed longitude and latitude.
- Invalid coordinates or time fail before any upstream call. Mocked timeouts and missing or malformed Horizons rows produce the documented error responses.
- `GET /api/sites` returns all nine presets with the correct latitude and longitude order. Include Malapert Massif as a test case because both coordinates are negative and differ substantially.
- The API runs locally without generating CSV files. Verify the existing batch entry point still uses the same CSV schema. Use mocked Horizons responses for automated tests and perform one live smoke check if network access is available.
- Hand back the endpoint URLs, launch command, example response, and any live checks that could not be performed. Frontend wiring is outside this task.
