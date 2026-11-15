# SELENE: Observatory direction

## Brief
Preserve the orbit background and grayscale Moon, including its existing lighting and interaction. Give the interface an identity distinct from Instinct. Remain usable as an exploration tool, not only a space-company marketing page.

## Research, 14 November 2026
These are observations from live pages and browser-computed typography, not claims about the companies' official brand guidelines.

| Reference | Observed treatment | Applicable principle |
| --- | --- | --- |
| https://www.interlune.space/ | PP Writer display type with Neue Haas Unica UI; spacious imagery; soft environmental palette | Separate the expressive scene from calm, readable controls |
| https://www.stokespace.com/ | Druk Wide headlines with Inter Display supporting text; strong scale contrast | Make the first heading decisive and keep supporting labels quiet |
| https://www.impulsespace.com/ | Monument Grotesk and Monument Grotesk Mono; compact technical navigation; structured mission table | Use monospaced text for coordinates, dates, units and precise labels |
| https://www.astranis.com/ | Dark field, spaced navigation, restrained layout and a conspicuous green action | Reserve accent treatment for selection and the primary action |

No third-party fonts, CSS, videos, logos or imagery were extracted from these companies.

## Typography alternatives considered
1. Editorial: a serif display with a neutral sans. Elegant, but would retain too much resemblance to the previous Instinct direction.
2. Industrial: an extra-wide, bold sans with a mono. Strong for launch-company storytelling, but would crowd a working explorer.
3. Observatory (implemented): Space Grotesk 400/500/600 and IBM Plex Mono 400/500. Open font families provide a practical display/UI and data pairing. This is our chosen pairing, not a claim that a reference uses these exact two fonts.

## Visual rules
- Preserve the approved black orbit field, lighting, texture and grayscale treatment.
- Space Grotesk: identity, headings, readable controls and explanations.
- IBM Plex Mono: coordinates, times, units, small section markers and numeric results.
- Warm-white main text; muted copper (#d3b08a) for selection indicators and small accents.
- Semantic pale gold for sunlight and blue-grey for Earth; do not use copper as a scientific status indicator.
- Small-radius controls, a quiet ruled navigation bar, underline-selected view tabs and an inset arrow on the primary button.
- Original orbital-ring wordmark symbol; no decorative pixel type or serif section headings.
- The landing-site panel is the primary interactive surface. The lower data section uses shared dividers instead of repeated floating cards.
- Move from an expressive scene to precise measurements as the user scrolls.

## Implementation and checks
The current theme is `dist/selene-theme.css`. The previous `instinct-theme.css` is retained but no longer loaded. Existing geometry, camera transitions, model data and UI event handlers are unchanged. Copy is made more specific to the user's task. Check desktop and phone widths, surface switching, visible keyboard focus, numeric legibility and loading of both fonts.

## Scientific boundary
This remains a frontend with illustrative ephemerides and procedural terrain. A visual redesign does not increase its scientific accuracy.


## Current refinement: shared grain
References for this refinement are exclusively Instinct Space and Impulse Space. Preserve Space Grotesk for all major headings and landing-site names; use DM Sans for prose and primary actions, IBM Plex Mono for navigation and measurements. Static SVG grain textures the two scenes, panels, buttons, inputs and colored timeline segments. A procedural repeating regolith texture gives the surface granular detail; it is not terrain data. Reduce stars from 1,500 to 140 across the entire surrounding sphere. Reserve the right-hand orbit canvas independently from the left-hand controls, including during zoom. Mobile stacks controls and the orbit view with a rightward bias.
