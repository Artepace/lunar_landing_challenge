/** View along the site's outward normal, with local north at the top.
 * This remains well-defined at both poles, unlike a fixed world-up camera.
 */
export function siteCameraFrame(lat: number, lon: number) {
  const p = (lat * Math.PI) / 180,
    l = (lon * Math.PI) / 180;
  return {
    direction: [
      Math.cos(p) * Math.cos(l),
      Math.sin(p),
      -Math.cos(p) * Math.sin(l),
    ],
    up: [-Math.sin(p) * Math.cos(l), Math.cos(p), Math.sin(p) * Math.sin(l)],
  };
}
