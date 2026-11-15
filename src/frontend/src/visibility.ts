import type { Body } from "./model";

export type LandingSite = { name: string; latitude: number; longitude: number };
type Direction = {
  azimuthDeg: number;
  elevationDeg: number;
  horizonElevationDeg: number;
  visibilityClearanceDeg: number;
};
type SunDirection = Direction & { visibleFraction: number };
type Directions = { sun: SunDirection; earth: Direction };
type Sample = Directions & { utc: string };

export type Visibility = {
  landingTimeUtc: string;
  stepMinutes: number;
  samples: Sample[];
  horizon: {
    source: "geometric" | "lola";
    reason: string | null;
    groundElevationM: number | null;
  };
};

export const HOUR_MS = 3_600_000;
export const WINDOW_HOURS = 72;

function apiUrl(path: string) {
  // On Vercel, keep VITE_API_BASE_URL unset: the browser uses public /api/*
  // rewrites on this origin. Runtime service-binding URLs are not browser URLs.
  const base = (import.meta.env?.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/${path}`;
}

export async function loadTerrain(
  latitude: number,
  longitude: number,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  });
  const response = await fetch(apiUrl(`terrain?${query}`), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The LOLA surface is unavailable.");
  return response.arrayBuffer();
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), options);
  } catch {
    throw new Error("Could not reach the KHONSU API.");
  }
  if (!response.ok) {
    if (response.status === 502)
      throw new Error("JPL Horizons data is unavailable.");
    if (response.status === 504)
      throw new Error("The visibility request timed out.");
    if (response.status === 422)
      throw new Error("Check the landing coordinates and UTC time.");
    throw new Error("Could not reach the KHONSU API.");
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Could not reach the KHONSU API.");
  }
  return response.json();
}

export async function loadSites(signal: AbortSignal): Promise<LandingSite[]> {
  const sites = await request<LandingSite[]>("sites", { signal });
  if (
    !Array.isArray(sites) ||
    sites.length === 0 ||
    !sites.every(
      (site) =>
        typeof site?.name === "string" &&
        Number.isFinite(site.latitude) &&
        Number.isFinite(site.longitude),
    )
  ) {
    throw new Error("Landing site presets are unavailable.");
  }
  return sites;
}

export async function loadVisibility(
  latitude: number,
  longitude: number,
  base: number,
  signal: AbortSignal,
): Promise<Visibility> {
  const result = await request<Visibility>("visibility", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      latitude,
      longitude,
      landingTimeUtc: new Date(base).toISOString(),
    }),
    signal,
  });
  if (
    Date.parse(result?.landingTimeUtc) !== base ||
    result.stepMinutes !== 15 ||
    !Array.isArray(result.samples) ||
    result.samples.length !== 289 ||
    !["geometric", "lola"].includes(result.horizon?.source) ||
    !result.samples.every(
      (sample, index) =>
        Date.parse(sample?.utc) === base + index * 900_000 &&
        [sample.sun, sample.earth].every(
          (body) =>
            body &&
            [
              body.azimuthDeg,
              body.elevationDeg,
              body.horizonElevationDeg,
              body.visibilityClearanceDeg,
            ].every(Number.isFinite),
        ) &&
        Number.isFinite(sample.sun.visibleFraction),
    )
  ) {
    throw new Error("The KHONSU API returned incomplete visibility data.");
  }
  return result;
}

const lerp = (a: number, b: number, fraction: number) => a + (b - a) * fraction;

function interpolateDirection(
  a: Direction,
  b: Direction,
  fraction: number,
): Direction {
  const azimuthDelta = ((b.azimuthDeg - a.azimuthDeg + 540) % 360) - 180;
  return {
    azimuthDeg: (a.azimuthDeg + azimuthDelta * fraction + 360) % 360,
    elevationDeg: lerp(a.elevationDeg, b.elevationDeg, fraction),
    horizonElevationDeg: lerp(
      a.horizonElevationDeg,
      b.horizonElevationDeg,
      fraction,
    ),
    visibilityClearanceDeg: lerp(
      a.visibilityClearanceDeg,
      b.visibilityClearanceDeg,
      fraction,
    ),
  };
}

export function directionsAt(series: Visibility, hours: number): Directions {
  const position = Math.max(
    0,
    Math.min(series.samples.length - 1, (hours * 60) / series.stepMinutes),
  );
  const index = Math.floor(position);
  const a = series.samples[index];
  const b = series.samples[Math.min(index + 1, series.samples.length - 1)];
  const fraction = position - index;
  return {
    sun: {
      ...interpolateDirection(a.sun, b.sun, fraction),
      visibleFraction: lerp(
        a.sun.visibleFraction,
        b.sun.visibleFraction,
        fraction,
      ),
    },
    earth: interpolateDirection(a.earth, b.earth, fraction),
  };
}

export function visibilityWindows(series: Visibility, body: Body) {
  const intervals: [number, number][] = [];
  const crossings: { hours: number; setting: boolean }[] = [];
  const step = series.stepMinutes / 60;
  let previous = series.samples[0][body].visibilityClearanceDeg;
  let start = previous > 0 ? 0 : null;
  for (let index = 1; index < series.samples.length; index++) {
    const current = series.samples[index][body].visibilityClearanceDeg;
    if (previous > 0 !== current > 0) {
      const hours = (index - 1 + previous / (previous - current)) * step;
      const setting = previous > 0;
      if (start !== null && hours > start) intervals.push([start, hours]);
      start = setting ? null : hours;
      crossings.push({ hours, setting });
    }
    previous = current;
  }
  const end = (series.samples.length - 1) * step;
  if (start !== null && start < end) intervals.push([start, end]);
  return { intervals, crossings };
}

export type SceneDirections = ReturnType<typeof directionsAt>;

export type SatelliteOption = { id: number; name: string };
export type SatelliteLink = {
  satellite: SatelliteOption & { epochUtc: string };
  landingTimeUtc: string;
  stepMinutes: number;
  samples: {
    utc: string;
    azimuthDeg: number;
    elevationDeg: number;
    access: boolean;
  }[];
  accessFraction: number;
  orbit: {
    periodMinutes: number;
    positionsKm: [number, number, number][];
    earthRotationDeg: number;
    moonDirection: [number, number, number];
  };
};

export async function loadSatellites(
  signal: AbortSignal,
): Promise<SatelliteOption[]> {
  const satellites = await request<SatelliteOption[]>("satellites", { signal });
  if (
    !Array.isArray(satellites) ||
    satellites.length === 0 ||
    !satellites.every(
      (satellite) =>
        Number.isInteger(satellite?.id) && typeof satellite.name === "string",
    )
  ) {
    throw new Error("The satellite list is unavailable.");
  }
  return satellites;
}

// Sends the chosen satellite back to the API with the landing site and time.
export async function loadSatelliteLink(
  latitude: number,
  longitude: number,
  base: number,
  satelliteId: number,
  signal: AbortSignal,
): Promise<SatelliteLink> {
  let response: Response;
  try {
    response = await fetch(apiUrl("satellite-link"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude,
        longitude,
        landingTimeUtc: new Date(base).toISOString(),
        satelliteId,
      }),
      signal,
    });
  } catch {
    throw new Error("Could not reach the KHONSU API.");
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Could not reach the KHONSU API.");
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      response.status === 409 && typeof result?.detail === "string"
        ? result.detail
        : response.status === 504
          ? "The satellite calculation timed out."
          : "Satellite orbit data is unavailable.",
    );
  }
  if (
    result?.satellite?.id !== satelliteId ||
    Date.parse(result.landingTimeUtc) !== base ||
    !Array.isArray(result.samples) ||
    result.samples.length === 0 ||
    !Array.isArray(result.orbit?.positionsKm) ||
    result.orbit.positionsKm.length < 3 ||
    !result.orbit.positionsKm.every(
      (point: unknown) =>
        Array.isArray(point) &&
        point.length === 3 &&
        point.every(Number.isFinite),
    )
  ) {
    throw new Error("Satellite orbit data is unavailable.");
  }
  return result;
}
