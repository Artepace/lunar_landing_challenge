export type Body = "sun" | "earth";
export const stations = {
  goldstone: { name: "Goldstone", lat: 35.426, lon: -116.89 },
  madrid: { name: "Madrid", lat: 40.431, lon: -4.249 },
  canberra: { name: "Canberra", lat: -35.398, lon: 148.981 },
};
export const rad = (d: number) => (d * Math.PI) / 180;
// This rotation is only for the Earth texture and the approximate station markers.
export function earthPreviewRotation(date: number) {
  const hours = (date - Date.UTC(2026, 10, 14, 12)) / 36e5;
  return (hours * Math.PI) / 12;
}
