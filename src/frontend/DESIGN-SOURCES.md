# KHONSU frontend — sources and design decisions

Updated 15 November 2026. The lunar explorer is original; the five requested React Bits UI components are vendored with their license in `src/reactbits/`.

## Free rendering options
- Three.js: https://threejs.org/ — MIT-licensed renderer. Vendored r170 with its license. Chosen for flexible camera transitions, textures, raycasting, and a custom surface scene; no account or API key.
- CesiumJS: https://cesium.com/platform/cesiumjs — Apache 2.0, free renderer. Supports a lunar ellipsoid: https://sandcastle.cesium.com/?id=moon . Hosted terrain/data services have separate terms. Appropriate for a later terrain-heavy implementation.
- NASA Moon 3D Models: https://svs.gsfc.nasa.gov/14959/ . The orbit view loads the original `Moon_NASA_LRO_8k_Topo_Small.glb`, using its mesh for picking and marker placement. Credit NASA's Goddard Space Flight Center. NASA identifies pinching at the poles as a model artifact.
- NASA CGI Moon Kit: https://svs.gsfc.nasa.gov/4720/ . Color and small height-preview images supply the textured globe while the GLB loads and if it fails. Credit NASA/Goddard/Scientific Visualization Studio, LRO/LROC/LOLA teams.
- Earth appearance: https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg . From the Three.js examples texture collection; illustrative appearance, not a current Earth observation. Retain its source attribution; verify original image terms before redistributing outside this prototype.
- The supplied `NoiseBackground.tsx` and `NoiseHero.tsx` inform the site-wide animated grain. The local Selena lander loop and its poster sit behind the interactive orbit view.
- The Orbit video and poster in `public/assets/khonsu-orbit-*` use the supplied spacecraft artwork, an AI-generated concept inspired by [Blue Origin's Blue Moon Mark 2 Alpha](https://www.nasa.gov/missions/artemis/nasa-partners-accelerate-lander-development-for-2028-moon-missions/). The grain, star field, and reflections were added for the animation. The open right side leaves room for the interactive Moon.

## Requested design references
- The Orbit and Surface switch uses [Gooey Nav](https://reactbits.dev/components/gooey-nav). The detached KHONSU mark takes its glass treatment from [Glass Surface](https://reactbits.dev/components/glass-surface) and [Fluid Glass](https://reactbits.dev/components/fluid-glass). The curved preset picker and shared flat buttons adapt [Option Wheel](https://reactbits.dev/components/option-wheel) and [Specular Button](https://reactbits.dev/components/specular-button).
- https://www.instinct-space.com/ — revised visual direction, inspected in-browser: Instrument Serif headlines, Workbench display labels, monochrome palette, floating dark navigation, white pill CTA, editorial section spacing and low-chrome content columns. KHONSU retains its own name, wording, controls, imagery and code. No Instinct logos, videos or spacecraft assets were copied. `instinct-theme.css` contains this reversible styling layer; body geometry and timings remain illustrative.
- https://drag-globe.learnframer.site/ — globe-image-grid interaction reference. Used the direct-manipulation idea: drag to orbit, click to select. This is a Three.js Moon, not the Framer component.
- https://strangepixels.co/en — sparse navigation and clear editorial hierarchy informed the large opening title and restrained chrome.
- https://www.foll-ow.com/ — scroll-led presentation informed the transition from exploration to a second, detailed section.
- https://godly.design/ — design discovery with Hero and CTA categories; used as an inspiration directory, not a component dependency.
- https://21st.dev/ and https://mcp.21st.dev/@muhammad-binsalman/components/stardust-button — reviewed component discovery and the celestial CTA concept. Implemented a simple original launch button, avoiding distracting perpetual animation.
- https://styles.refero.design/ — design-system reference library; used consistent spacing, surfaces and typography rather than mixing unrelated component styles.
- https://sumo.com/ returned a Refract page without readable content; no specific UI pattern attributed.
- https://desk.gallery/ could not be retrieved; no design claim or dependency based on it.

## Implemented flow
1. Explore a textured 3D Moon; choose a preset, click the globe or enter coordinates.
2. Enter UTC landing time, descend, and drag to look around the surface.
3. Look at Sun or Earth, including an approximate ground-station point on Earth.
4. Scroll to event countdowns, advance scene time and view visibility windows.

## Scientific boundary
The explorer uses JPL Horizons directions and, where available, a NASA LOLA terrain mask for the visibility timeline. The GLB provides orbital visualization. At covered landing sites, the Surface view draws a curved mesh from the same LOLA maps at true scale, with the camera 2 m above the selected coordinates. The visibility calculation samples the terrain more densely than the visual mesh. Ground texture, lighting, and Earth station orientation are illustrative, and body sizes and distances are exaggerated for readability. See the [backend guide](../Ephemeris/README.md) for the calculation and data coverage.

## React Bits integration — 15 November 2026

Downloaded the TypeScript/CSS registry implementations for SpecularButton, OptionWheel, GooeyNav, GlassSurface, and FluidGlass from `https://reactbits.dev/r/{Name}-TS-CSS.json`. Retain `src/reactbits/LICENSE.md`. Local adaptations add button ref support, Specular Buttons within Gooey Nav, descriptive wheel labeling and active-descendant semantics, Home/End navigation, and reduced-motion wheel smoothing. The preset wrapper stages a choice before applying its coordinates. Specular glow is disabled so highlights remain on the border; the primary action has a flat pastel-gold fill (#eddfa8), inspired by the spacecraft foil. Glass Surface contains the detached top-left wordmark and the Fluid Glass torus logo.

The refinement removes duplicate CSS button borders so the React Bits canvas supplies a single matching-radius edge, removes the wheel selection guides, uses Space Grotesk for all headings, and slightly darkens the noise background (grain opacity 0.075).

## Simplified explorer — 15 November 2026

- Landing-site selection applies directly from the wheel; clicking an option closes it. Only the selected name is yellow, with neutral grey alternatives.
- Shared buttons now use a quiet CSS border; the older Specular Button and glass component sources remain archived under `src/reactbits/` but are no longer mounted. Gooey Nav remains the view selector.
- Orbit and Surface use the Lucide [Orbit](https://lucide.dev/icons/orbit) and [Mountain](https://lucide.dev/icons/mountain) symbols. ISC license retained in `public/icons/LICENSE`.
- The original minimal KHONSU mark combines a lunar arc, horizon, and landing beacon. Editable vector: `public/khonsu-mark.svg`.
- One continuous noise field replaces the section-specific glow. The Moon has fixed camera distance and responsive framing; wheel and pinch zoom are disabled.
- Surface view retains measured LOLA geometry and adds procedural multi-scale regolith, deterministic stones placed on that mesh, and local stone shadows with Sun-aligned lighting. Rocks, grain, and fill illumination are illustrative and do not alter elevation data or visibility calculations. Lunar-surface reference: [NASA Moon facts](https://science.nasa.gov/moon/facts/).
