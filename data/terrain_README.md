# Data sources

For every dataset or API, document the provider, source link, version or access date, license or terms of use, and the feature that uses it. Include any download and preprocessing steps needed to reproduce the demo. Keep bulk downloads in `data/raw/`.

## LOLA south pole digital elevation models (DEMs)

- **Provider:** NASA Goddard Space Flight Center, Planetary Geodesy Data Archive (PGDA); Lunar Reconnaissance Orbiter (LRO) Lunar Orbiter Laser Altimeter (LOLA)
- **Source page:** https://pgda.gsfc.nasa.gov/products/90 ("A New View of the Lunar South Pole from LOLA")
- **Citation:** Barker, M. K. et al. (2023), *Planetary Science Journal*, 4, 183, doi:10.3847/PSJ/acf3e1. Data DOI: 10.60903/gsfcpgda-lola-spole
- **Accessed:** 2026-11-14
- **Format:** Cloud-optimised GeoTIFF, south polar stereographic projection, metres, Moon sphere R = 1737.4 km, MOON_ME frame (JPL DE421). Heights in metres relative to the 1737.4 km sphere.
- **Used by:** `src/terrain/` (terrain heights and horizon masks for illumination and Earth-visibility assessment)

| File | Coverage | Pixel size | Size | Purpose |
|---|---|---|---|---|
| `LDEM_80S_80MPP_ADJ.TIF` | 80°S to pole (±304 km) | 80 m | 181 MB | Main working DEM |
| `LDEM_60S_240MPP_ADJ.TIF` | 60°S to pole | 240 m | 210 MB | Far-field fallback for horizon rays leaving the 80°S map |

Optional higher-resolution replacements for final results: `LDEM_80S_40MPP_ADJ.TIF` (685 MB) or `LDEM_80S_20MPP_ADJ.TIF` (2.6 GB).

### Download

1. Open https://pgda.gsfc.nasa.gov/products/90 and download the files above.
2. Save them in `data/raw/` **with their original filenames** (e.g. `data/raw/LDEM_80S_80MPP_ADJ.TIF`).
3. These two maps are tracked with Git LFS; other files in `data/raw/` remain ignored. If cloning the repository, install Git LFS and run `git lfs install` followed by `git lfs pull` instead of downloading them manually.
4. Start or restart the SELENE API after saving the maps. The API uses the 80°S map for the observer's ground height and the 60°S map to fill farther terrain along each ray. A result uses the geometric horizon if a required sightline runs beyond available terrain.

### Verify the maps

Run `python scripts/check_terrain_data.py` from the repository root. This checks both files against `data/terrain_manifest.json` and rejects missing files, unexpanded Git LFS pointers, and corrupt downloads.

### Vercel

Enable **Git LFS** in the Vercel project's Git settings before deploying. The API build verifies the maps, and the function includes both TIFF files. The files total 408,119,431 bytes, before dependencies. Use Fluid compute with Large Functions support; for an existing project, enable `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` if needed. Keep the Vercel project root at the repository root. Git LFS downloads count toward the repository owner's LFS bandwidth allowance.
