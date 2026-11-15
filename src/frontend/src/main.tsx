import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Chrome } from "./Chrome";
import { LunarScene, type Station, type View } from "./LunarScene";
import { OrbitBackdrop } from "./NoiseBackground";
import { OptionWheel } from "./OptionWheel";
import { SpecularButton } from "./SpecularButton";
import { OrbitSymbol, SurfaceSymbol } from "./Symbols";
import GooeyNav from "./reactbits/GooeyNav";
import { stations, type Body } from "./model";
import {
  directionsAt,
  HOUR_MS,
  loadSites,
  loadVisibility,
  visibilityWindows,
  WINDOW_HOURS,
  type LandingSite,
  type Visibility,
} from "./visibility";
import "./styles.css";
import "./selene-theme.css";

const initialDate = "2026-11-14T12:00";
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const initialSite = {
  name: "Custom landing site",
  lat: -89.5,
  lon: 30,
  base: Date.parse(initialDate + "Z"),
};
const bodies: Body[] = ["sun", "earth"];
const names = { sun: "Sun", earth: "Earth" };
const stationLabels = {
  goldstone: "Goldstone, USA",
  madrid: "Madrid, Spain",
  canberra: "Canberra, Australia",
};
const formatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const ticks = ["Landing", "+24 h", "+48 h", "+72 h"].map((text) => (
  <span key={text}>{text}</span>
));
const horizonReasons: Record<string, string> = {
  "outside-coverage": "The site is outside the LOLA south-pole coverage.",
  "frame-unavailable": "LOLA coverage is unavailable for this date.",
  "dem-missing": "The LOLA elevation maps are missing on the server.",
  "incomplete-coverage":
    "The LOLA maps have gaps along this site's sightlines.",
  "dem-unavailable": "The server could not read the LOLA elevation maps.",
};
type Result =
  { key: string; visibility: Visibility } | { key: string; error: string };

function App() {
  const [view, setView] = useState<View>("orbit");
  const [backgroundMotion, setBackgroundMotion] = useState(
    () => !matchMedia(reducedMotionQuery).matches,
  );
  const [site, setSite] = useState(initialSite);
  const [preset, setPreset] = useState("");
  const [sites, setSites] = useState<LandingSite[]>([]);
  const [sitesFailed, setSitesFailed] = useState(false);
  const [siteRetry, setSiteRetry] = useState(0);
  const [result, setResult] = useState<Result>();
  const [retry, setRetry] = useState(0);
  const [latitude, setLat] = useState(String(initialSite.lat));
  const [longitude, setLon] = useState(String(initialSite.lon));
  const [date, setDate] = useState(initialDate);
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [station, setStation] = useState<Station>("goldstone");
  const [facing, setFacing] = useState(false);
  const [command, setCommand] = useState<{ target: Body | "reset" }>({
    target: "reset",
  });
  const form = useRef<HTMLFormElement>(null);
  const explore = useRef<HTMLElement>(null);
  const { lat, lon, base } = site;
  const key = `${lat}/${lon}/${base}/${retry}`;
  const current = result?.key === key ? result : undefined;
  const visibility =
    current && "visibility" in current ? current.visibility : undefined;
  const error = current && "error" in current ? current.error : undefined;
  const time = base + offset * HOUR_MS;
  const data = visibility ? directionsAt(visibility, offset) : undefined;
  const stationInfo = stations[station];
  const windows = useMemo(
    () =>
      visibility && bodies.map((body) => visibilityWindows(visibility, body)),
    [visibility],
  );
  useEffect(() => {
    const preference = matchMedia(reducedMotionQuery);
    const applyPreference = (event: MediaQueryListEvent) =>
      setBackgroundMotion(!event.matches);
    preference.addEventListener("change", applyPreference);
    return () => preference.removeEventListener("change", applyPreference);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadSites(controller.signal).then(setSites, () => {
      if (!controller.signal.aborted) setSitesFailed(true);
    });
    return () => controller.abort();
  }, [siteRetry]);
  useEffect(() => {
    const controller = new AbortController();
    loadVisibility(lat, lon, base, controller.signal).then(
      (visibility) => {
        if (!controller.signal.aborted) setResult({ key, visibility });
      },
      (error: Error) => {
        if (!controller.signal.aborted)
          setResult({ key, error: error.message });
      },
    );
    return () => controller.abort();
  }, [lat, lon, base, key]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => setOffset((value) => Math.min(WINDOW_HOURS, value + 0.15)),
      250,
    );
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (offset >= WINDOW_HOURS) setPlaying(false);
  }, [offset]);
  const commit = (
    nextPreset: string,
    lat: number,
    lon: number,
    nextDate: string,
  ) => {
    setSite({
      name: nextPreset || "Custom landing site",
      lat,
      lon,
      base: Date.parse(nextDate + "Z"),
    });
    setOffset(0);
    setPlaying(false);
  };
  const descend = () => {
    if (!form.current?.reportValidity()) return;
    commit(preset, Number(latitude), Number(longitude), date);
    setView("surface");
  };
  const selectPreset = (selected: string) => {
    setPreset(selected);
    const next = sites.find(({ name }) => name === selected);
    if (!next) return;
    setLat(String(next.latitude));
    setLon(String(next.longitude));
    const validDate =
      form.current?.querySelector<HTMLInputElement>("#date")?.validity.valid;
    commit(
      selected,
      next.latitude,
      next.longitude,
      validDate ? date : new Date(site.base).toISOString().slice(0, 16),
    );
  };
  return (
    <Chrome
      motion={backgroundMotion}
      onToggleMotion={() => setBackgroundMotion((motion) => !motion)}
    >
      <section
        id="explore"
        ref={explore}
        className={`explore${view === "surface" ? " surface-mode" : ""}`}
      >
        {view === "orbit" && <OrbitBackdrop motion={backgroundMotion} />}
        <LunarScene
          view={view}
          lat={site.lat}
          lon={site.lon}
          time={time}
          directions={data}
          station={station}
          command={command}
          onFacing={setFacing}
          onPick={(lat, lon) => {
            const pickedLat = lat.toFixed(4),
              pickedLon = lon.toFixed(4);
            setPreset("");
            setLat(pickedLat);
            setLon(pickedLon);
            const validDate =
              form.current?.querySelector<HTMLInputElement>("#date")?.validity
                .valid;
            commit(
              "",
              Number(pickedLat),
              Number(pickedLon),
              validDate ? date : new Date(site.base).toISOString().slice(0, 16),
            );
          }}
        />
        <div className="hero-copy" hidden={view !== "orbit"}>
          <h1>
            See the Moon.
            <br />
            <em>Plan the moment.</em>
          </h1>
          <p>
            Choose a landing site to see when sunlight and Earth are visible.
          </p>
        </div>
        <div className="scene-toolbar">
          <GooeyNav
            items={[
              { label: "Orbit", icon: <OrbitSymbol /> },
              { label: "Surface", icon: <SurfaceSymbol /> },
            ]}
            activeIndex={view === "orbit" ? 0 : 1}
            onChange={(index) => {
              if (index === 0) setView("orbit");
              else if (view === "orbit") descend();
            }}
            size="sm"
            color="#eddfa8"
            activeTextColor="#16181c"
            particleCount={10}
            animationTime={560}
            className="view-navigation"
          />
          <SpecularButton
            className="round-button"
            aria-label="Reset camera view"
            onClick={() => setCommand({ target: "reset" })}
          >
            ↺
          </SpecularButton>
        </div>
        <aside className="site-panel frosted-panel" hidden={view !== "orbit"}>
          <div className="panel-heading">
            <span className="eyebrow">YOUR LANDING SITE</span>
          </div>
          <OptionWheel
            label="Landing site preset"
            value={preset}
            options={[
              { value: "", label: "Custom coordinates" },
              ...sites.map(({ name }) => ({ value: name, label: name })),
            ]}
            onChange={selectPreset}
          />
          {sitesFailed && (
            <p className="panel-note">
              Presets unavailable.{" "}
              <SpecularButton
                type="button"
                className="text-button"
                onClick={() => {
                  setSitesFailed(false);
                  setSiteRetry((value) => value + 1);
                }}
              >
                Retry
              </SpecularButton>
            </p>
          )}
          <p className="panel-note">
            Illustrative viewpoint · not a landing recommendation
          </p>
          <form
            id="site-form"
            ref={form}
            onSubmit={(event) => {
              event.preventDefault();
              descend();
              explore.current?.scrollIntoView({
                behavior: matchMedia(reducedMotionQuery).matches
                  ? "instant"
                  : "smooth",
              });
            }}
          >
            <div className="coordinate-grid">
              <label>
                Latitude <span>° N</span>
                <input
                  id="latitude"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  value={latitude}
                  onChange={(event) => {
                    setPreset("");
                    setLat(event.currentTarget.value);
                  }}
                  required
                />
              </label>
              <label>
                Longitude <span>° E</span>
                <input
                  id="longitude"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  value={longitude}
                  onChange={(event) => {
                    setPreset("");
                    setLon(event.currentTarget.value);
                  }}
                  required
                />
              </label>
            </div>
            <label className="date-label">
              Landing date &amp; time <span>UTC</span>
              <input
                id="date"
                type="datetime-local"
                value={date}
                min="2000-01-01T00:00"
                max="2100-12-31T23:59"
                onChange={(event) => {
                  setDate(event.currentTarget.value);
                  if (form.current?.checkValidity())
                    commit(
                      preset,
                      Number(latitude),
                      Number(longitude),
                      event.currentTarget.value,
                    );
                }}
                required
              />
            </label>
            <SpecularButton type="submit" className="primary-button">
              Take me to the surface <span>↗</span>
            </SpecularButton>
          </form>
          <div className="panel-footer">
            <span className="crosshair">⌖</span>Or click anywhere on the Moon
          </div>
        </aside>
        <div className="surface-heading" hidden={view !== "surface"}>
          <span className="eyebrow">YOU ARE HERE</span>
          <h1>{site.name}</h1>
          <p>Drag to look around · Sun and Earth sizes exaggerated</p>
          <div className="look-buttons">
            {bodies.map((body) => (
              <SpecularButton
                key={body}
                disabled={!data}
                onClick={() => setCommand({ target: body })}
              >
                Look at {names[body]} ↗
              </SpecularButton>
            ))}
          </div>
        </div>
        <a className="scroll-cue" href="#windows">
          YOUR NEXT WINDOWS <span>↓</span>
        </a>
      </section>
      <section className="windows" id="windows">
        <div className="section-intro">
          <h2>
            Your horizon.
            <br />
            Hour by hour.
          </h2>
          {visibility && (
            <span className="data-badge">
              {visibility.horizon.source === "lola"
                ? "JPL Horizons + NASA LOLA"
                : "JPL Horizons · geometric horizon"}
            </span>
          )}
        </div>
        {visibility?.horizon.reason && (
          <p className="model-note">
            {horizonReasons[visibility.horizon.reason]}
          </p>
        )}
        {!visibility || !data || !windows ? (
          <div className="time-console frosted-panel" role="status">
            <span>{error ?? "Calculating the 72-hour visibility window…"}</span>
            {error && (
              <SpecularButton
                className="play-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry
              </SpecularButton>
            )}
          </div>
        ) : (
          <>
            <div className="time-console frosted-panel">
              <div>
                <span className="eyebrow">SCENE TIME / UTC</span>
                <strong>{formatter.format(time)}</strong>
              </div>
              <div className="scrubber">
                <label htmlFor="time-slider">
                  Explore after landing{" "}
                  <output>+{Number(offset.toFixed(2))} h</output>
                </label>
                <input
                  id="time-slider"
                  type="range"
                  min="0"
                  max={WINDOW_HOURS}
                  step=".25"
                  value={offset}
                  onChange={(event) =>
                    setOffset(event.currentTarget.valueAsNumber)
                  }
                />
                <div className="ticks">{ticks}</div>
              </div>
              <SpecularButton
                className="play-button"
                aria-pressed={playing}
                onClick={() => {
                  if (offset >= WINDOW_HOURS) setOffset(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Ⅱ Pause" : "▶ Play"}
              </SpecularButton>
            </div>
            <div className="event-grid">
              {bodies.map((body, index) => {
                const crossing = windows[index].crossings.find(
                  ({ hours }) => hours > offset,
                );
                const eventTime = crossing
                  ? Math.round((base + crossing.hours * HOUR_MS) / 60_000) *
                    60_000
                  : null;
                const minutes =
                  eventTime === null
                    ? 0
                    : Math.round((eventTime - time) / 60_000);
                const position = data[body];
                return (
                  <article key={body}>
                    <div className="event-top">
                      <span className={`body-icon ${body}-icon`}>
                        {body === "sun" ? "☀" : "◉"}
                      </span>
                      <span className="eyebrow">
                        {body === "sun" ? "SOLAR WINDOW" : "EARTH VISIBILITY"}
                      </span>
                      <span className="status">
                        {position.visibilityClearanceDeg > 0
                          ? "VISIBLE"
                          : "HIDDEN"}
                      </span>
                    </div>
                    <h3>
                      {crossing
                        ? `${names[body]} ${crossing.setting ? "sets" : "rises"} in`
                        : `No upcoming ${names[body]} crossing`}
                    </h3>
                    <div className="countdown">
                      {crossing
                        ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
                        : "Through +72 h"}
                    </div>
                    {eventTime !== null && (
                      <p>{formatter.format(eventTime)} UTC · estimated</p>
                    )}
                    <div className="angles">
                      <span>
                        Elevation <b>{position.elevationDeg.toFixed(1)}°</b>
                      </span>
                      <span>
                        Azimuth <b>{position.azimuthDeg.toFixed(1)}°</b>
                      </span>
                      <span>
                        Horizon{" "}
                        <b>{position.horizonElevationDeg.toFixed(1)}°</b>
                      </span>
                    </div>
                  </article>
                );
              })}
              <article className="station-card">
                <div className="event-top">
                  <span className="body-icon">⌁</span>
                  <span className="eyebrow">GROUND STATION</span>
                </div>
                <label className="sr-only" htmlFor="station">
                  Earth ground station
                </label>
                <select
                  id="station"
                  value={station}
                  onChange={(event) =>
                    setStation(event.currentTarget.value as Station)
                  }
                >
                  {Object.entries(stationLabels).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <p>
                  {stationInfo.lat.toFixed(3)}° N · {stationInfo.lon.toFixed(3)}
                  ° E
                </p>
                <div className="station-orb" aria-hidden="true">
                  <div className="station-dot" />
                  <span>EARTH</span>
                </div>
                <div className="station-summary">
                  {data.earth.visibilityClearanceDeg <= 0
                    ? "Earth centre below the lunar horizon"
                    : facing
                      ? "Station faces the Moon · demo"
                      : "Station on far side of Earth · demo"}
                </div>
                <small>
                  Station orientation is illustrative. Radio-link availability
                  requires separate analysis.
                </small>
              </article>
            </div>
            <div className="timeline-heading">
              <h3>Visibility over the next 72 hours</h3>
              <span>Solid = visible · dim = hidden</span>
            </div>
            <div>
              {bodies.map((body, index) => (
                <div className={`track-row ${body}`} key={body}>
                  <span>{body === "sun" ? "☀ Sun" : "◉ Earth"}</span>
                  <div
                    className="track"
                    role="img"
                    aria-label={`${names[body]} visibility during 72 hours`}
                  >
                    {windows[index].intervals.map(([a, b]) => (
                      <span
                        className="track-segment"
                        key={a}
                        style={{
                          left: `${(a / WINDOW_HOURS) * 100}%`,
                          width: `${((b - a) / WINDOW_HOURS) * 100}%`,
                        }}
                      />
                    ))}
                    <span
                      className="track-cursor"
                      style={{
                        left: `calc(${(offset / WINDOW_HOURS) * 100}% - 1px)`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="timeline-axis">{ticks}</div>
            <p className="model-note">
              Crossing times are estimated between 15-minute samples. Sun
              windows begin when the upper limb clears the horizon. Earth
              windows track its centre. The 3D scene uses illustrative lighting.
            </p>
          </>
        )}
      </section>
    </Chrome>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
