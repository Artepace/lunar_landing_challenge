/** Convert the surface's north-clockwise azimuth/elevation to the Moon's
 * body-fixed frame (+Y north, +X zero longitude, east toward -Z).
 * Distances are illustrative; sightlines from the selected site are preserved.
 */
export function orbitPosition(
  lat: number,
  lon: number,
  azimuth: number,
  elevation: number,
  distance: number,
): [number, number, number] {
  const r = Math.PI / 180;
  const p = lat * r,
    l = lon * r,
    a = azimuth * r,
    e = elevation * r;
  const up = [
    Math.cos(p) * Math.cos(l),
    Math.sin(p),
    -Math.cos(p) * Math.sin(l),
  ];
  const north = [
    -Math.sin(p) * Math.cos(l),
    Math.cos(p),
    Math.sin(p) * Math.sin(l),
  ];
  const east = [-Math.sin(l), 0, -Math.cos(l)];
  return up.map(
    (v, i) =>
      2 * v +
      distance *
        (Math.sin(e) * v +
          Math.cos(e) * (Math.cos(a) * north[i] + Math.sin(a) * east[i])),
  ) as [number, number, number];
}
