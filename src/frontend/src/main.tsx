import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ForecastArticle } from "./ForecastArticle";
import { Chrome } from "./Chrome";
import { LunarScene, type Station, type View } from "./LunarScene";
import { ScenePlayer } from "./ScenePlayer";
import { OrbitScene } from "./OrbitScene";
import { CommsLinkStage, type CommsMode } from "./CommsLink";
import { OrbitBackdrop } from "./NoiseBackground";
import { GlassCalendar } from "./components/ui/glass-calendar";
import { OptionWheel } from "./OptionWheel";
import { SpecularButton } from "./SpecularButton";
import { PlannerSymbol, OrbitSymbol, SurfaceSymbol } from "./Symbols";
import GooeyNav from "./reactbits/GooeyNav";
import {
  CUSTOM_SITE_NAME,
  clampCustomSite,
  stations,
  type Body,
} from "./model";
import {
  directionsAt,
  HOUR_MS,
  loadSatelliteLink,
  loadSatellites,
  loadSites,
  loadVisibility,
  visibilityWindows,
  WINDOW_HOURS,
  type LandingSite,
  type SatelliteLink,
  type SatelliteOption,
  type Visibility,
} from "./visibility";
import "./styles.css";
import "./khonsu-theme.css";

const initialDate = "2026-11-15T14:00";
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const initialSite = {
  name: "Peak near Cabeus B",
  lat: -83.661,
  lon: -69.014,
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
  const [view, setView] = useState<View>("planner");
  const [lunarBackdrop, setLunarBackdrop] = useState<HTMLCanvasElement>();
  const [backgroundMotion, setBackgroundMotion] = useState(
    () => !matchMedia(reducedMotionQuery).matches,
  );
  const [site, setSite] = useState(initialSite);
  const [preset, setPreset] = useState(initialSite.name);
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
  const [commsMode, setCommsMode] = useState<CommsMode>("ground");
  const [satellites, setSatellites] = useState<SatelliteOption[]>();
  const [satellitesError, setSatellitesError] = useState<string>();
  const [satelliteRetry, setSatelliteRetry] = useState(0);
  const [satelliteId, setSatelliteId] = useState<number>();
  const [linkResult, setLinkResult] = useState<
    { key: string; link: SatelliteLink } | { key: string; error: string }
  >();
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
  // The satellite list is requested once the satellite link is ticked.
  const wantsSatellites = commsMode === "satellite";
  useEffect(() => {
    if (!wantsSatellites || satellites) return;
    const controller = new AbortController();
    setSatellitesError(undefined);
    loadSatellites(controller.signal).then(setSatellites, (error: Error) => {
      if (!controller.signal.aborted) setSatellitesError(error.message);
    });
    return () => controller.abort();
  }, [wantsSatellites, satellites, satelliteRetry]);
  // The chosen satellite goes back to the API with the site and landing time.
  const linkKey =
    wantsSatellites && satelliteId !== undefined
      ? `${lat}/${lon}/${base}/${satelliteId}`
      : undefined;
  useEffect(() => {
    if (!linkKey || satelliteId === undefined) return;
    const controller = new AbortController();
    loadSatelliteLink(lat, lon, base, satelliteId, controller.signal).then(
      (link) => {
        if (!controller.signal.aborted) setLinkResult({ key: linkKey, link });
      },
      (error: Error) => {
        if (!controller.signal.aborted)
          setLinkResult({ key: linkKey, error: error.message });
      },
    );
    return () => controller.abort();
  }, [lat, lon, base, satelliteId, linkKey]);
  const currentLink = linkResult?.key === linkKey ? linkResult : undefined;
  // The wheel always shows a selection, so start on the first satellite.
  useEffect(() => {
    if (wantsSatellites && satellites && satelliteId === undefined)
      setSatelliteId(satellites[0].id);
  }, [wantsSatellites, satellites, satelliteId]);
  useEffect(() => {
    if (!playing || view === "planner") return;
    const timer = window.setInterval(
      () => setOffset((value) => Math.min(WINDOW_HOURS, value + 0.15)),
      250,
    );
    return () => clearInterval(timer);
  }, [playing, view]);
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
      name: nextPreset || CUSTOM_SITE_NAME,
      lat,
      lon,
      base: Date.parse(nextDate + "Z"),
    });
    setOffset(0);
    setPlaying(false);
  };
  const togglePlay = () => {
    if (offset >= WINDOW_HOURS) setOffset(0);
    setPlaying(!playing);
  };
  const descend = () => {
    if (!form.current?.reportValidity()) return;
    if (
      Number(latitude) !== lat ||
      Number(longitude) !== lon ||
      Date.parse(date + "Z") !== base
    )
      commit(preset, Number(latitude), Number(longitude), date);
    setView("surface");
  };
  const validDate = () =>
    Number.isFinite(Date.parse(date + "Z"))
      ? date
      : new Date(site.base).toISOString().slice(0, 16);
  // A custom site comes from a click on the Moon or the caption's coordinates.
  const setCustomSite = (pickedLat: number, pickedLon: number) => {
    const next = clampCustomSite(pickedLat, pickedLon);
    setPreset("");
    setLat(String(next.latitude));
    setLon(String(next.longitude));
    commit("", next.latitude, next.longitude, validDate());
  };
  const selectPreset = (selected: string) => {
    if (!selected) {
      // The wheel also reports the custom entry after a pick selects it.
      if (!preset) return;
      setCustomSite(Number(latitude), Number(longitude));
      return;
    }
    setPreset(selected);
    const next = sites.find(({ name }) => name === selected);
    if (!next) return;
    setLat(String(next.latitude));
    setLon(String(next.longitude));
    const validDate = Number.isFinite(Date.parse(date + "Z"));
    commit(
      selected,
      next.latitude,
      next.longitude,
      validDate ? date : new Date(site.base).toISOString().slice(0, 16),
    );
  };
  return (
    <Chrome
      navigation={
        <GooeyNav
          items={[
            { label: "Planner", icon: <PlannerSymbol /> },
            { label: "Orbit", icon: <OrbitSymbol /> },
            { label: "Surface", icon: <SurfaceSymbol /> },
          ]}
          activeIndex={["planner", "orbit", "surface"].indexOf(view)}
          onChange={(index) => {
            if (index === 0) setView("planner");
            else if (index === 1) setView("orbit");
            else if (view !== "surface") descend();
          }}
          theme="dark"
          size="md"
          frame
          color="#eddfa8"
          activeTextColor="#16181c"
          particleCount={15}
          spread={56}
          animationTime={450}
          timeVariance={300}
          gooeyness={0.5}
          wobble={0.5}
          hoverEffect
          className="view-navigation"
        />
      }
      motion={backgroundMotion}
      onToggleMotion={() => setBackgroundMotion((motion) => !motion)}
    >
      <section id="explore" ref={explore} className={`explore ${view}-mode`}>
        {view === "planner" && <OrbitBackdrop motion={backgroundMotion} />}
        {view === "orbit" ? (
          <OrbitScene
            resetCommand={command}
            lat={site.lat}
            lon={site.lon}
            time={time}
            directions={data}
            visibility={visibility}
            error={error}
            offset={offset}
            playing={playing}
            onOffset={setOffset}
            onTogglePlay={() => {
              if (offset >= WINDOW_HOURS) setOffset(0);
              setPlaying(!playing);
            }}
          />
        ) : (
          <LunarScene
            onBackdrop={setLunarBackdrop}
            view={view}
            lat={site.lat}
            lon={site.lon}
            time={time}
            directions={data}
            station={station}
            command={command}
            onFacing={setFacing}
            onPick={setCustomSite}
          />
        )}
        <div className="hero-copy" hidden={view !== "planner"}>
          <h1>
            See the Moon.
            <br />
            <em>Plan the moment.</em>
          </h1>
          <p>
            Choose a landing site to see when sunlight and Earth are visible.
          </p>
        </div>

        <aside
          className="site-panel planner-controls"
          hidden={view !== "planner"}
        >
          <OptionWheel
            label="Landing site preset"
            value={preset}
            options={[
              { value: "", label: CUSTOM_SITE_NAME },
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
            <GlassCalendar
              value={date}
              onChange={(nextDate) => {
                setDate(nextDate);
                commit(preset, Number(latitude), Number(longitude), nextDate);
              }}
            />
            <SpecularButton type="submit" className="primary-button">
              Take me to the surface
            </SpecularButton>
          </form>
          <div className="panel-footer">
            <span className="crosshair">⌖</span>Or click anywhere on the Moon
          </div>
        </aside>
        <div className="surface-heading" hidden={view !== "surface"}>
          <span className="eyebrow">YOU ARE HERE</span>
          <h1>{site.name}</h1>
          <p>
            Drag to look around · Shift + scroll to zoom · Sun and Earth sizes
            exaggerated
          </p>
          <div className="look-buttons">
            {bodies.map((body) => (
              <SpecularButton
                key={body}
                disabled={!data}
                onClick={() => setCommand({ target: body })}
              >
                Look at {names[body]}
              </SpecularButton>
            ))}
          </div>
        </div>
        {view === "surface" && (
          <ScenePlayer
            backdrop={lunarBackdrop}
            time={time}
            offset={offset}
            playing={playing}
            disabled={!data}
            onOffset={setOffset}
            onTogglePlay={togglePlay}
            className="surface-player"
            note={
              error ??
              (data
                ? "Shared with Orbit · Explore the next 72 hours from your landing site"
                : "Calculating the 72-hour visibility window…")
            }
          />
        )}
        <a className="scroll-cue" href="#windows" hidden={view === "planner"}>
          YOUR NEXT WINDOWS <span>↓</span>
        </a>
      </section>
      {view === "planner" && (
        <CommsLinkStage
          mode={commsMode}
          onMode={setCommsMode}
          station={station}
          stationLabels={stationLabels}
          onStation={setStation}
          satellites={satellites}
          satellitesError={satellitesError}
          onRetrySatellites={() => setSatelliteRetry((value) => value + 1)}
          satelliteId={satelliteId}
          onSatellite={setSatelliteId}
          link={
            currentLink && "link" in currentLink ? currentLink.link : undefined
          }
          linkError={
            currentLink && "error" in currentLink
              ? currentLink.error
              : undefined
          }
          time={base}
        />
      )}
      <section className="windows" id="windows" hidden={view === "planner"}>
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
                  <ForecastArticle key={body}>
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
                  </ForecastArticle>
                );
              })}
              <ForecastArticle className="station-card">
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
              </ForecastArticle>
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
