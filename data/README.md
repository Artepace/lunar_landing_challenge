# Data sources

For every dataset or API, document the provider, source link, version or access date, license or terms of use, and the feature that uses it. Include any download and preprocessing steps needed to reproduce the demo. Keep bulk downloads in `data/raw/`.

## Frontend prototype assets (14 November 2026)

- NASA Moon 3D Models: https://svs.gsfc.nasa.gov/14959/ — NASA's original `Moon_NASA_LRO_8k_Topo_Small.glb` in `src/frontend/public/assets/` supplies the orbit view. Credit NASA's Goddard Space Flight Center.
- NASA CGI Moon Kit: https://svs.gsfc.nasa.gov/4720/ — 1k LROC-derived color image and small LOLA-derived height preview in `src/frontend/public/assets/` supply the globe preview. Credit NASA/Goddard/Scientific Visualization Studio and LRO instrument teams.
- Earth texture: https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg — downloaded unchanged for illustrative rendering. Original third-party image terms remain applicable; source credited in the application.
- Three.js r170 is distributed under the MIT license and installed via npm.
- Sun and Earth directions come from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/). The timeline estimates crossings from its 15-minute observations and the [LOLA elevation maps](terrain_README.md) where covered. Ground-station orientation and the 3D landscape remain illustrative.
- Full research and design notes: `src/frontend/DESIGN-SOURCES.md`.
