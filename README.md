# Lunar Landing Challenge

A starter repository for our 2026 NASA Space Apps Challenge project on lunar landing.

## Project and demo

- Challenge brief: https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/
- Project: SELENE, an interactive Moon-to-surface explorer for comparing sunlight and Earth visibility.
- SELENE combines JPL Horizons Sun and Earth positions with NASA LOLA south-pole elevation maps. The explorer displays a 72-hour visibility timeline for named sites or custom coordinates.

## Run locally

Requires Python 3.10+ and Node.js 22.13+. The server needs internet access to query JPL Horizons. No API key is needed.

From the repository root, create a Python environment and start the API:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn src.Ephemeris.api:app --host 127.0.0.1 --port 8000
```

For Windows activation and API examples, see the [backend guide](src/Ephemeris/README.md). To enable terrain-aware results, download the two maps described in the [terrain data guide](data/terrain_README.md) into `data/raw/`. The app labels results based on geometric visibility when terrain coverage is unavailable.

In a second terminal, start the frontend:

```sh
cd src/frontend
npm ci
npm run dev
```

Open [the explorer](http://127.0.0.1:4173). For a single-server build, run `npm run build` in `src/frontend`, then start or restart Uvicorn and open [the built explorer](http://127.0.0.1:8000).

To use the standalone `node server.mjs` preview on port 4173, build first and run it alongside the Python API. Restart a preview started before the API proxy was added.

Select a preset, click the Moon, or enter coordinates. Choose **Take me to the surface**, then drag to look around. The Surface view renders measured LOLA terrain where the maps cover the site and its surroundings. Scroll down for the time slider, rise/set readouts and station selector. Return to **Orbit** to choose another site. See `src/frontend/DESIGN-SOURCES.md` for data credits and limitations.

Run `npm test` in `src/frontend` for timeline tests and `python -m unittest discover -s tests -v` from the repository root for API tests after installing `requirements-dev.txt`.

## Repository layout

- [`src/`](src/) holds the project source code.
- [`data/`](data/) records data sources, licenses, and download instructions.
- [Judging rules](JUDGING_RULES.md) contains the local and global scoring rubric.
- [License](LICENSE) covers original project code. Third-party materials retain their own terms.

## Data and credits

Record each NASA, partner, or third-party resource in [the data notes](data/README.md). Explain which feature uses each dataset and include the source citations in the official project submission.
