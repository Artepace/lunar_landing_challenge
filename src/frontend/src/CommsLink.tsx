import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { rad, stations } from "./model";
import { OptionWheel } from "./OptionWheel";
import { orbitDistance } from "./orbitFraming";
import { disposeObjects, spherical } from "./sceneObjects";
import { SpecularButton } from "./SpecularButton";
import type { SatelliteLink, SatelliteOption } from "./visibility";

export type CommsMode = "ground" | "satellite";
type StationKey = keyof typeof stations;

const EARTH_RADIUS_KM = 6378.137;
const earthRadius = 2; // Same globe size as the planner Moon.
const paper = 0xf3f3df;

// Greenwich mean sidereal angle: how far Earth has turned in the star frame.
const siderealDeg = (ms: number) => {
  const days = ms / 86_400_000 + 2440587.5 - 2451545;
  return (((280.46061837 + 360.98564736629 * days) % 360) + 360) % 360;
};
// Star-frame (ICRF) x, y, z to this scene's axes, with north up.
const fromIcrf = ([x, y, z]: readonly number[], scale = 1) =>
  new THREE.Vector3(x * scale, z * scale, -y * scale);
const formatPeriod = (minutes: number) =>
  minutes >= 120
    ? `${(minutes / 60).toFixed(1)} h`
    : `${Math.round(minutes)} min`;

type Props = {
  mode: CommsMode;
  onMode: (mode: CommsMode) => void;
  station: StationKey;
  stationLabels: Record<StationKey, string>;
  onStation: (station: StationKey) => void;
  satellites?: SatelliteOption[];
  satellitesError?: string;
  onRetrySatellites: () => void;
  satelliteId?: number;
  onSatellite: (id: number) => void;
  link?: SatelliteLink;
  linkError?: string;
  time: number;
};

// The planner's second stage, below the Moon: choose what the lander talks
// to, and see it on an Earth drawn like the planner Moon.
export function CommsLinkStage(props: Props) {
  const { mode, link, satellites, satelliteId } = props;
  const chosen = satellites?.find(({ id }) => id === satelliteId);
  const now = link?.samples[0];
  return (
    <section
      className="comms-stage"
      id="comms"
      aria-label="Communications link"
    >
      <EarthLinkScene
        time={props.time}
        station={mode === "ground" ? props.station : undefined}
        link={mode === "satellite" ? link : undefined}
      />
      <div className="comms-copy planner-controls">
        <span className="eyebrow">COMMS LINK</span>
        <h2>
          Call home.
          <br />
          <em>Choose the link.</em>
        </h2>
        <div className="look-buttons" role="group" aria-label="Link type">
          {(
            [
              ["ground", "Ground station"],
              ["satellite", "Satellite"],
            ] as const
          ).map(([value, label]) => (
            <SpecularButton
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => props.onMode(value)}
            >
              {label}
            </SpecularButton>
          ))}
        </div>
        {mode === "ground" ? (
          <OptionWheel
            key="ground"
            label="Ground station"
            value={props.station}
            options={Object.entries(props.stationLabels).map(
              ([value, label]) => ({ value, label }),
            )}
            onChange={(value) => props.onStation(value as StationKey)}
          />
        ) : satellites ? (
          <OptionWheel
            key="satellite"
            label="Satellite"
            value={String(satelliteId ?? "")}
            options={satellites.map(({ id, name }) => ({
              value: String(id),
              label: name,
            }))}
            onChange={(value) => props.onSatellite(Number(value))}
          />
        ) : (
          <p className="panel-note comms-loading" role="status">
            {props.satellitesError ? (
              <>
                {props.satellitesError}{" "}
                <SpecularButton
                  type="button"
                  className="text-button"
                  onClick={props.onRetrySatellites}
                >
                  Retry
                </SpecularButton>
              </>
            ) : (
              "Loading satellites…"
            )}
          </p>
        )}
        <p className="panel-note" role="status">
          {mode === "ground"
            ? `Direct to Earth · ${stations[props.station].name} shown at the landing time`
            : props.linkError
              ? props.linkError
              : link && now
                ? `${link.satellite.name} · in line of sight ${Math.round(link.accessFraction * 100)}% of the next 72 h · ${now.elevationDeg.toFixed(1)}° elevation at landing · ${formatPeriod(link.orbit.periodMinutes)} orbit`
                : chosen
                  ? `Calculating ${chosen.name}…`
                  : ""}
        </p>
        {mode === "satellite" && (
          <p className="panel-note">
            Geometric line of sight · lunar terrain and link budget not included
          </p>
        )}
      </div>
    </section>
  );
}

// Earth with either the chosen ground station or the chosen satellite and one
// revolution of its orbit, both placed for the landing time.
function EarthLinkScene({
  time,
  station,
  link,
}: {
  time: number;
  station?: StationKey;
  link?: SatelliteLink;
}) {
  const host = useRef<HTMLDivElement>(null);
  const markerLabel = useRef<HTMLDivElement>(null);
  const update =
    useRef<(time: number, station?: StationKey, link?: SatelliteLink) => void>(
      undefined,
    );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    // Same finish as the planner Moon.
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 600);
    scene.add(camera);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    let needsRender = true;
    controls.addEventListener("change", () => {
      needsRender = true;
    });

    const texture = new THREE.TextureLoader().load(
      import.meta.env.BASE_URL + "assets/earth.jpg",
      () => {
        needsRender = true;
      },
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(earthRadius, 128, 64),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
    );
    scene.add(earth, new THREE.AmbientLight(0xc6c8cc, 0.25));
    // The key light travels with the camera so the visible face stays lit.
    const sunlight = new THREE.DirectionalLight(0xfff2dd, 3.2);
    sunlight.position.set(-3, 4, 6);
    camera.add(sunlight, sunlight.target);
    sunlight.target.position.set(0, 0, -10);

    const dot = () => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 16, 12),
        new THREE.MeshBasicMaterial({ color: paper }),
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.05, 0.058, 40),
        new THREE.MeshBasicMaterial({ color: paper, side: THREE.DoubleSide }),
      );
      marker.add(ring);
      return { marker, ring };
    };
    const stationDot = dot();
    earth.add(stationDot.marker);
    const satelliteDot = dot();
    const orbit = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: paper,
        transparent: true,
        opacity: 0.7,
      }),
    );
    const moonLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: 0x9aa3ad,
        dashSize: 0.2,
        gapSize: 0.16,
        transparent: true,
        opacity: 0.6,
      }),
    );
    scene.add(satelliteDot.marker, orbit, moonLine);

    let active: THREE.Object3D | undefined;
    let reach = earthRadius;
    const frameCamera = (direction?: THREE.Vector3) => {
      const width = container.clientWidth,
        height = container.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      // A wide orbit pulls the camera back until the whole orbit fits.
      const distance =
        orbitDistance(width, height) *
        Math.max(1, reach / (earthRadius * 1.12));
      controls.minDistance = controls.maxDistance = distance;
      (direction ? camera.position.copy(direction) : camera.position)
        .normalize()
        .multiplyScalar(distance);
      const size = distance / orbitDistance(width, height);
      stationDot.marker.scale.setScalar(size);
      satelliteDot.marker.scale.setScalar(size * 1.4);
      camera.lookAt(0, 0, 0);
      controls.update();
      needsRender = true;
    };

    update.current = (time, station, link) => {
      earth.rotation.y = rad(
        link ? link.orbit.earthRotationDeg : siderealDeg(time),
      );
      earth.updateMatrixWorld();
      stationDot.marker.visible = !link && Boolean(station);
      satelliteDot.marker.visible =
        orbit.visible =
        moonLine.visible =
          Boolean(link);
      let direction: THREE.Vector3;
      if (link) {
        const points = link.orbit.positionsKm.map((p) =>
          fromIcrf(p, earthRadius / EARTH_RADIUS_KM),
        );
        orbit.geometry.setFromPoints(points);
        satelliteDot.marker.position.copy(points[0]);
        active = satelliteDot.marker;
        reach = Math.max(...points.map((p) => p.length()));
        const normal = points[0]
          .clone()
          .cross(points[Math.floor(points.length / 4)])
          .normalize();
        if (normal.y < 0) normal.negate();
        const moon = fromIcrf(link.orbit.moonDirection);
        moonLine.geometry.setFromPoints([
          moon.clone().multiplyScalar(earthRadius * 1.02),
          moon.clone().multiplyScalar(Math.max(reach * 0.9, earthRadius * 1.5)),
        ]);
        moonLine.computeLineDistances();
        // Look from above the orbit plane, on the satellite's side.
        direction = points[0]
          .clone()
          .normalize()
          .multiplyScalar(0.85)
          .add(normal.multiplyScalar(0.55));
      } else {
        const { lat, lon } = stations[station ?? "goldstone"];
        stationDot.marker.position.copy(
          spherical(lat, lon, earthRadius * 1.004),
        );
        active = station ? stationDot.marker : undefined;
        reach = earthRadius;
        direction = spherical(lat * 0.6, lon + 14, 1).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          earth.rotation.y,
        );
      }
      frameCamera(direction);
    };

    const world = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      if (!needsRender) return;
      needsRender = false;
      stationDot.ring.lookAt(camera.position);
      satelliteDot.ring.lookAt(camera.position);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      const label = markerLabel.current;
      if (!label) return;
      label.style.display = "none";
      if (!active) return;
      active.getWorldPosition(world);
      // Hide the label while Earth is between the camera and its point.
      toCamera.copy(camera.position).sub(world);
      const along = -world.dot(toCamera) / toCamera.lengthSq();
      const nearest = world.clone().addScaledVector(toCamera, along);
      if (along > 0 && along < 1 && nearest.length() < earthRadius * 0.995)
        return;
      const projected = world.clone().project(camera);
      label.style.display = "block";
      label.style.left = `${Math.min((projected.x * 0.5 + 0.5) * container.clientWidth + 12, container.clientWidth - label.offsetWidth - 8)}px`;
      label.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight - 10}px`;
    };
    const resize = new ResizeObserver(() => frameCamera());
    resize.observe(container);
    frame = requestAnimationFrame(animate);
    return () => {
      update.current = undefined;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      disposeObjects(scene);
      orbit.geometry.dispose();
      moonLine.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => update.current?.(time, station, link), [time, station, link]);

  return (
    <div className="comms-scene">
      <div className="comms-canvas" ref={host} />
      {failed && (
        <div id="loading" role="status">
          3D view unavailable
        </div>
      )}
      <div className="scene-label" ref={markerLabel}>
        {link ? (
          <>
            SATELLITE{" "}
            <span>
              {link.satellite.name} · NORAD {link.satellite.id}
            </span>
          </>
        ) : (
          station && (
            <>
              GROUND STATION{" "}
              <span>
                {stations[station].name} · {stations[station].lat.toFixed(3)}° N
                / {stations[station].lon.toFixed(3)}° E
              </span>
            </>
          )
        )}
      </div>
      <div className="view-caption">
        <span>DRAG TO ROTATE · EARTH AT LANDING TIME</span>
        <span>
          {link
            ? "CelesTrak orbit · dashed line points to the Moon"
            : "Station position is illustrative"}
        </span>
      </div>
    </div>
  );
}
