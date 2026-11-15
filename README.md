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
python -m uvicorn src.Ephemeris.Earth_sun_Position.api:app --host 127.0.0.1 --port 8000
```

For Windows activation and API examples, see the [backend guide](src/Ephemeris/Earth_sun_Position/README.md). To enable terrain-aware results, download the two maps described in the [terrain data guide](data/terrain_README.md) into `data/raw/`. The app labels results based on geometric visibility when terrain coverage is unavailable.

In a second terminal, start the frontend:

```sh
cd src/frontend
npm ci
npm run dev
```

Open [the explorer](http://127.0.0.1:4173). For a single-server build, run `npm run build` in `src/frontend`, then start or restart Uvicorn and open [the built explorer](http://127.0.0.1:8000).

To use the standalone `node server.mjs` preview on port 4173, build first and run it alongside the Python API. Restart a preview started before the API proxy was added.

Use **Planner** to select a site with the option wheel or by clicking the Moon, then choose the landing date and UTC time. **Orbit** and **Surface** share the 72-hour player and visibility forecast. Drag to change the view; hold Shift while scrolling to zoom. See `src/frontend/DESIGN-SOURCES.md` for data credits and limitations.

## Deploy to Vercel

The root [`vercel.json`](vercel.json) defines one project with two independently built services. Import the repository with project root `.` (not `src/frontend`). Keep build/runtime overrides in each service, not at the top level or as a frontend-only project override.

- `app`: FastAPI at the repository root, entrypoint `app:app`. Public requests under `/api/` retain their prefix and reach the existing `/api/sites`, `/api/visibility`, and `/api/terrain` handlers. The function allows 120 seconds, above the API's 65-second calculation deadline. Python function packaging excludes frontend assets and includes both Git LFS terrain maps. The API build verifies their checksums.
- `frontend`: Vite in `src/frontend`, built with `npm run build` to `dist`. All other public paths go here.
- No internal-only services or service bindings are configured. API calls originate in the browser, not a frontend function. Leave `VITE_API_BASE_URL` unset so they use same-origin `/api/*`. Binding URLs are runtime-only and must not be embedded into a Vite build. The localhost URLs in `vite.config.ts` and `server.mjs` are only for the standalone local development/preview workflow; they are not production routing.
- `app.py` intentionally disables FastAPI's local static-site mount, so a leftover frontend build cannot interfere with the separate Vite service. The existing Uvicorn entrypoint still supports the local single-server build.

With a current Vercel CLI that supports services, test from the repository root:

```sh
vercel dev --local
```

Check the frontend at the printed URL and `/api/sites` on that same origin. Stop with Ctrl+C. To test with your Vercel project configuration instead, use `vercel dev`. For cloud deployment, connect this GitHub repository in Vercel or use `vercel` from the repository root. No deployment is performed by adding these files.

**Terrain data:** the two required LOLA maps are tracked with Git LFS. Enable Git LFS downloads in the Vercel project's Git settings, then redeploy. The API build fails clearly if it receives pointer files instead of map data. The maps total about 408 MB before Python dependencies, so use Fluid compute with [Large Functions support](https://vercel.com/changelog/vercel-functions-can-now-be-up-to-5-gb-in-package-size); existing projects may need `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` in Vercel environment variables. Nothing sets that project option automatically. A full cloud build must verify the final Linux bundle size and runtime memory use. See [terrain setup](data/terrain_README.md) for local checkout and checksum verification. Terrain outside the maps' coverage still uses the existing fallback. JPL Horizons requires outbound network access at runtime.

References: [Vercel services](https://vercel.com/docs/services), [routing](https://vercel.com/docs/services/routing), [runtime-only bindings](https://vercel.com/docs/services/bindings).

Run `npm test` in `src/frontend` for timeline tests and `python -m unittest discover -s tests -v` from the repository root for API tests after installing `requirements-dev.txt`.

## Repository layout

- [`src/`](src/) holds the project source code.
- [`data/`](data/) records data sources, licenses, and download instructions.
- [Judging rules](JUDGING_RULES.md) contains the local and global scoring rubric.
- [License](LICENSE) covers original project code. Third-party materials retain their own terms.

## Data and credits

Record each NASA, partner, or third-party resource in [the data notes](data/README.md). Explain which feature uses each dataset and include the source citations in the official project submission.
