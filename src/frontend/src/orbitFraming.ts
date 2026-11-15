// A stable globe diameter with breathing room, including narrow viewports.
export function orbitDistance(
  width: number,
  height: number,
  verticalFov = 42,
  radius = 2,
) {
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  const halfAngle = Math.atan(
    Math.tan((verticalFov * Math.PI) / 360) * Math.min(1, aspect) * 0.82,
  );
  return radius / Math.sin(halfAngle);
}
