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
3. `data/raw/` is git-ignored, so the files are never committed.
