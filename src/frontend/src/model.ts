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

// Custom landing sites stay inside the south-polar band the app is built for.
export const CUSTOM_SITE_LIMITS = {
  latitude: { min: -89.9, max: -75 },
  longitude: { min: -180, max: 180 },
};
export const CUSTOM_SITE_NAME = "Custom landing site";

export function clampCustomSite(latitude: number, longitude: number) {
  const { latitude: lat, longitude: lon } = CUSTOM_SITE_LIMITS;
  const clamp = (value: number, min: number, max: number) =>
    Number(Math.min(max, Math.max(min, value)).toFixed(4));
  return {
    latitude: clamp(latitude, lat.min, lat.max),
    longitude: clamp(longitude, lon.min, lon.max),
  };
}
