import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { earthPreviewRotation, rad, stations, type Body } from "./model";
import {
  createObjects,
  disposeObjects,
  loadTopographicMoon,
  spherical,
} from "./sceneObjects";
import { siteCameraFrame } from "./siteCameraFrame";
import { orbitDistance } from "./orbitFraming";
import { surfaceRocks } from "./surfaceDetails";
import { unpackSurfaceMesh } from "./surfaceTerrain";
import { loadTerrain, type SceneDirections } from "./visibility";

export type Station = keyof typeof stations;
export type View = "planner" | "orbit" | "surface";
type Props = {
  view: Exclude<View, "orbit">;
  lat: number;
  lon: number;
  time: number;
  directions?: SceneDirections;
  station: Station;
  command: { target: Body | "reset" };
  onFacing: (facing: boolean) => void;
  onBackdrop: (canvas: HTMLCanvasElement | undefined) => void;
};
const previewEyeHeight = 2;
const measuredEyeHeight = previewEyeHeight / 1_000;
const previewSkyDistance = 160;
const measuredSkyDistance = 200;
const sky = (az: number, el: number, distance = previewSkyDistance) =>
  new THREE.Vector3(
    Math.sin(rad(az)) * Math.cos(rad(el)),
    Math.sin(rad(el)),
    -Math.cos(rad(az)) * Math.cos(rad(el)),
  ).multiplyScalar(distance);

export function LunarScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const siteLabel = useRef<HTMLDivElement>(null);
  const sunLabel = useRef<HTMLDivElement>(null);
  const earthLabel = useRef<HTMLDivElement>(null);
  const hiddenSun = useRef<HTMLDivElement>(null);
  const hiddenEarth = useRef<HTMLDivElement>(null);
  const stationLabel = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const [message, setMessage] = useState("Preparing the Moon…");
  const [moonCaption, setMoonCaption] = useState("Loading NASA topography…");
  const [surfaceCaption, setSurfaceCaption] = useState("Loading LOLA terrain…");
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        logarithmicDepthBuffer: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setMessage(
        "3D rendering is unavailable. The visibility timeline is still available.",
      );
      setMoonCaption("3D view unavailable");
      setSurfaceCaption("3D view unavailable");
      return;
    }
    let disposed = false;
    let needsRender = true;
    let issue = "";
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    latest.current.onBackdrop(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1500);
    let controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.addEventListener("change", () => {
      needsRender = true;
    });
    const {
      orbitGroup,
      surfaceGroup,
      moon,
      marker,
      ring,
      earth,
      sun,
      stationMarker,
      terrain,
      ambient,
      surfaceLight,
    } = createObjects(
      scene,
      () => {
        if (!disposed) {
          needsRender = true;
          setMessage(issue);
        }
      },
      (error) => {
        issue = error;
        if (!disposed) setMessage(error);
      },
    );
    let mode: View = "planner";
    let rocks: THREE.Group | null = null;
    const previewTerrain = terrain.geometry;
    const previewBumpScale = terrain.material.bumpScale;
    let terrainSite = "";
    let terrainRequest: AbortController | undefined;
    let eyeHeight = previewEyeHeight;
    let skyDistance = previewSkyDistance;
    let yaw = 0,
      pitch = 0;
    let flight: {
      start: number;
      from: THREE.Vector3;
      to: THREE.Vector3;
    } | null = null;
    let command = latest.current.command;
    let drag: {
      x: number;
      y: number;
      lastX: number;
      lastY: number;
      moved: boolean;
    } | null = null;
    let frame = 0;
    let lastData = latest.current;
    let data = lastData.directions;
    let facing = false;
    const ray = new THREE.Raycaster();
    let markerLat: number, markerLon: number;
    const syncMarker = () => {
      markerLat = lastData.lat;
      markerLon = lastData.lon;
      const outward = spherical(markerLat, markerLon, 1);
      ray.set(outward.clone().multiplyScalar(3), outward.clone().negate());
      const hit = ray.intersectObject(moon, true)[0];
      if (hit) marker.position.copy(hit.point).addScaledVector(outward, 0.015);
      else marker.position.copy(outward).multiplyScalar(2.015);
    };
    const reset = () => {
      camera.fov = 42;
      camera.near = 0.01;
      camera.updateProjectionMatrix();
      const distance = orbitDistance(
        container.clientWidth,
        container.clientHeight,
      );
      controls.minDistance = controls.maxDistance = distance;
      const frame = siteCameraFrame(lastData.lat, lastData.lon);
      camera.up.fromArray(frame.up);
      camera.position.fromArray(frame.direction).multiplyScalar(distance);
      // OrbitControls caches the camera-up frame at construction.
      controls.dispose();
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.enableZoom = false;
      controls.minDistance = controls.maxDistance = distance;
      controls.addEventListener("change", () => {
        needsRender = true;
      });
      controls.target.set(0, 0, 0);
      controls.update();
    };
    const look = (body: Body) => {
      yaw = data?.[body].azimuthDeg ?? 0;
      pitch = Math.max(-80, Math.min(74, data?.[body].elevationDeg ?? 0));
    };
    const syncObjects = () => {
      data = lastData.directions;
      const unit = terrain.geometry === previewTerrain ? 1 : 0.001;
      const lightDirection = data
        ? sky(data.sun.azimuthDeg, data.sun.elevationDeg, 150 * unit)
        : new THREE.Vector3(-80, 35, -80).multiplyScalar(unit);
      surfaceLight.position.copy(lightDirection);
      surfaceLight.intensity = !data
        ? 3.2
        : data.sun.visibilityClearanceDeg > 0
          ? 3.2
          : 0;
      surfaceLight.shadow.normalBias = 0.015 * unit;
      const shadowCamera = surfaceLight.shadow.camera;
      shadowCamera.left = shadowCamera.bottom = -65 * unit;
      shadowCamera.right = shadowCamera.top = 65 * unit;
      shadowCamera.near = 0.01 * unit;
      shadowCamera.far = 300 * unit;
      shadowCamera.updateProjectionMatrix();
      if (lastData.lat !== markerLat || lastData.lon !== markerLon)
        syncMarker();
      sun.visible = Boolean(data && data.sun.visibilityClearanceDeg > 0);
      earth.visible = Boolean(data && data.earth.visibilityClearanceDeg > 0);
      if (!data) {
        facing = false;
        lastData.onFacing(false);
        return;
      }
      sun.position.copy(
        sky(data.sun.azimuthDeg, data.sun.elevationDeg, skyDistance),
      );
      earth.position.copy(
        sky(data.earth.azimuthDeg, data.earth.elevationDeg, skyDistance),
      );
      if (terrain.geometry !== previewTerrain) {
        sun.position.y += eyeHeight;
        earth.position.y += eyeHeight;
      }
      earth.rotation.y = earthPreviewRotation(lastData.time) + Math.PI;
      const station = stations[lastData.station];
      stationMarker.position.copy(spherical(station.lat, station.lon, 6.15));
      earth.updateMatrixWorld(true);
      facing =
        stationMarker
          .getWorldPosition(new THREE.Vector3())
          .sub(earth.position)
          .dot(earth.position) < 0;
      stationMarker.visible = facing;
      lastData.onFacing(facing);
    };
    const setSurfaceCamera = () => {
      camera.up.set(0, 1, 0);
      camera.position.set(0, eyeHeight, 0);
      camera.near = terrain.geometry === previewTerrain ? 0.01 : 0.00025;
      camera.updateProjectionMatrix();
    };
    const showTerrain = (geometry: THREE.BufferGeometry | null) => {
      if (terrain.geometry !== previewTerrain) terrain.geometry.dispose();
      terrain.geometry = geometry ?? previewTerrain;
      if (rocks) {
        surfaceGroup.remove(rocks);
        disposeObjects(rocks);
      }
      rocks = surfaceRocks(terrain, geometry ? 0.001 : 1);
      surfaceGroup.add(rocks);
      terrain.material.bumpScale = geometry
        ? previewBumpScale / 1_000
        : previewBumpScale;
      eyeHeight = geometry ? measuredEyeHeight : previewEyeHeight;
      skyDistance = geometry ? measuredSkyDistance : previewSkyDistance;
      sun.scale.setScalar(skyDistance / previewSkyDistance);
      earth.scale.setScalar(skyDistance / previewSkyDistance);
      if (surfaceGroup.visible) setSurfaceCamera();
      syncObjects();
      needsRender = true;
    };
    const requestTerrain = () => {
      const { lat, lon } = lastData;
      const key = `${lat}/${lon}`;
      if (terrainSite === key) return;
      terrainSite = key;
      terrainRequest?.abort();
      const controller = new AbortController();
      terrainRequest = controller;
      showTerrain(null);
      setSurfaceCaption("Loading LOLA terrain…");
      loadTerrain(lat, lon, controller.signal)
        .then((mesh) => {
          if (controller.signal.aborted) return;
          if (mesh) showTerrain(unpackSurfaceMesh(mesh));
          setSurfaceCaption(
            mesh
              ? "NASA LOLA terrain"
              : "Illustrative terrain · no LOLA coverage",
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSurfaceCaption("Illustrative terrain · LOLA unavailable");
        });
    };
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      if (mode === "planner") {
        const distance = orbitDistance(width, height);
        controls.minDistance = controls.maxDistance = distance;
        camera.position.normalize().multiplyScalar(distance);
        controls.update();
      }
      camera.updateProjectionMatrix();
      needsRender = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    reset();
    resize();
    syncObjects();
    const modelRequest = new AbortController();
    loadTopographicMoon(moon, modelRequest.signal).then(
      () => {
        if (disposed) return;
        syncMarker();
        needsRender = true;
        setMoonCaption("NASA LRO topography");
      },
      () => {
        if (!disposed)
          setMoonCaption("NASA LRO imagery · topography unavailable");
      },
    );
    const project = (
      label: HTMLDivElement | null,
      object: THREE.Object3D,
      show: boolean,
      lift = 10,
      horizontalGap = 12,
    ) => {
      if (!label) return;
      label.style.display = "none";
      if (!show) return;
      const point = object
        .getWorldPosition(new THREE.Vector3())
        .project(camera);
      const x = (point.x * 0.5 + 0.5) * container.clientWidth;
      const y = (-point.y * 0.5 + 0.5) * container.clientHeight;
      if (
        point.z <= -1 ||
        point.z >= 1 ||
        x < 12 ||
        x > container.clientWidth - 35 ||
        y < 25 ||
        y > container.clientHeight - 45
      )
        return;
      label.style.display = "block";
      // The planner canvas is translated vertically in CSS. Layout offsets
      // omit that transform, so anchor labels to its rendered rectangle.
      const bounds = container.getBoundingClientRect();
      const parentBounds = label.offsetParent?.getBoundingClientRect();
      const left = bounds.left - (parentBounds?.left ?? 0);
      const top = bounds.top - (parentBounds?.top ?? 0);
      label.style.left = `${Math.min(left + x + horizontalGap, left + container.clientWidth - label.offsetWidth - 8)}px`;
      label.style.top = `${top + y - lift}px`;
    };
    // DOM outlines remain visible through terrain when the body is below
    // the measured horizon, while retaining its actual projected direction.
    const projectHiddenBody = (
      outline: HTMLDivElement | null,
      object: THREE.Object3D,
      radius: number,
      show: boolean,
    ) => {
      if (!outline) return;
      outline.style.display = "none";
      if (!show) return;
      const position = object.getWorldPosition(new THREE.Vector3());
      const depth = -position.clone().applyMatrix4(camera.matrixWorldInverse).z;
      const point = position.project(camera);
      if (
        depth <= camera.near ||
        Math.abs(point.x) > 1 ||
        Math.abs(point.y) > 1 ||
        Math.abs(point.z) > 1
      )
        return;
      const diameter =
        (radius * object.scale.x * container.clientHeight) /
        (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth);
      outline.style.width =
        outline.style.height = `${Math.max(12, diameter)}px`;
      outline.style.left = `${container.offsetLeft + (point.x * 0.5 + 0.5) * container.clientWidth}px`;
      outline.style.top = `${container.offsetTop + (-point.y * 0.5 + 0.5) * container.clientHeight}px`;
      outline.style.display = "block";
    };
    const finishFlight = () => {
      flight = null;
      orbitGroup.visible = false;
      surfaceGroup.visible = true;
      setSurfaceCamera();
      look("earth");
      pitch = -7;
    };
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      if (document.hidden) return;
      const current = latest.current;
      if (current !== lastData) {
        const changedSite =
          current.lat !== lastData.lat || current.lon !== lastData.lon;
        lastData = current;
        syncObjects();
        if (changedSite && current.view === "planner") reset();
        if (
          current.view === "surface" &&
          (mode !== current.view || changedSite)
        )
          requestTerrain();
        needsRender = true;
      }
      if (mode !== current.view) {
        mode = current.view;
        if (mode === "surface") requestTerrain();
        controls.enabled = mode === "planner";
        ambient.intensity = mode === "planner" ? 0.25 : 0.22;
        if (mode === "planner") {
          flight = null;
          orbitGroup.visible = true;
          surfaceGroup.visible = false;
          reset();
        } else if (matchMedia("(prefers-reduced-motion: reduce)").matches)
          finishFlight();
        else
          flight = {
            start: now,
            from: camera.position.clone(),
            to: spherical(current.lat, current.lon, 2.06),
          };
      }
      if (command !== current.command) {
        command = current.command;
        if (mode === "planner") reset();
        else {
          if (command.target === "reset") {
            camera.fov = 42;
            camera.updateProjectionMatrix();
          }
          look(command.target === "reset" ? "earth" : command.target);
        }
      }
      if (flight) {
        needsRender = true;
        const t = Math.min(1, (now - flight.start) / 1100);
        camera.position.lerpVectors(
          flight.from,
          flight.to,
          t * t * (3 - 2 * t),
        );
        camera.lookAt(0, 0, 0);
        if (t === 1) finishFlight();
      }
      if (mode === "planner") {
        controls.update();
        if (needsRender) ring.lookAt(camera.position);
      } else if (!flight && needsRender)
        camera.lookAt(camera.position.clone().add(sky(yaw, pitch, 1)));
      if (!needsRender) return;
      needsRender = false;
      camera.updateMatrixWorld();
      project(
        siteLabel.current,
        marker,
        mode === "planner" &&
          marker.position.dot(camera.position.clone().sub(marker.position)) > 0,
        4,
        5,
      );
      project(
        sunLabel.current,
        sun,
        mode === "surface" && !flight && Boolean(data),
      );
      project(
        earthLabel.current,
        earth,
        mode === "surface" && !flight && Boolean(data),
      );
      project(
        stationLabel.current,
        stationMarker,
        mode === "surface" && !flight && earth.visible && facing,
        50,
      );
      projectHiddenBody(
        hiddenSun.current,
        sun,
        3,
        mode === "surface" && !flight && Boolean(data) && !sun.visible,
      );
      projectHiddenBody(
        hiddenEarth.current,
        earth,
        6,
        mode === "surface" && !flight && Boolean(data) && !earth.visible,
      );
      renderer.render(scene, camera);
    };
    const down = (event: PointerEvent) => {
      drag = {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
      if (mode === "surface") container.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      drag.moved ||=
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5;
      if (mode === "surface") {
        needsRender = true;
        yaw -= (event.clientX - drag.lastX) * 0.23;
        pitch = Math.max(
          -80,
          Math.min(74, pitch + (event.clientY - drag.lastY) * 0.23),
        );
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    };
    const up = () => {
      drag = null;
    };
    const cancel = () => {
      drag = null;
    };
    const zoom = (event: WheelEvent) => {
      if (
        mode !== "surface" ||
        flight ||
        !event.shiftKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? container.clientHeight
            : 1;
      // Shift can turn vertical wheel input into horizontal deltas.
      const delta = (event.deltaY || event.deltaX) * unit;
      // Adjust the lens, keeping the observer at the landing site.
      camera.fov = THREE.MathUtils.clamp(
        camera.fov * Math.exp(THREE.MathUtils.clamp(delta * 0.0015, -0.5, 0.5)),
        18,
        75,
      );
      camera.updateProjectionMatrix();
      needsRender = true;
    };
    const contextLost = (event: Event) => {
      latest.current.onBackdrop(undefined);
      event.preventDefault();
      setMessage("3D view interrupted. Reload to restore it.");
    };
    renderer.domElement.addEventListener("wheel", zoom, { passive: false });
    container.addEventListener("pointerdown", down);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", up);
    container.addEventListener("pointercancel", cancel);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    frame = requestAnimationFrame(animate);
    return () => {
      latest.current.onBackdrop(undefined);
      disposed = true;
      modelRequest.abort();
      terrainRequest?.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("wheel", zoom);
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", up);
      container.removeEventListener("pointercancel", cancel);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      if (terrain.geometry !== previewTerrain) previewTerrain.dispose();
      disposeObjects(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  const data = props.directions;
  return (
    <>
      <div
        id="scene"
        ref={host}
        role="img"
        aria-label={
          props.view === "planner"
            ? "Interactive Moon. Drag to rotate and click to choose a landing site."
            : "Lunar horizon. Drag to look around. Hold Shift and scroll to zoom."
        }
      />
      {message && (
        <div id="loading" role="status">
          {message}
        </div>
      )}
      <div className="scene-label" ref={siteLabel}>
        LANDING SITE{" "}
        <span>
          {props.lat.toFixed(3)}° N / {props.lon.toFixed(3)}° E
        </span>
      </div>
      <div
        className="hidden-body-outline hidden-sun"
        ref={hiddenSun}
        role="img"
        aria-label="Sun position below the horizon"
      />
      <div
        className="hidden-body-outline hidden-earth"
        ref={hiddenEarth}
        role="img"
        aria-label="Earth position below the horizon"
      />
      <div className="scene-label sun-label" ref={sunLabel}>
        ☀ SUN{" "}
        <span>
          {data?.sun.elevationDeg.toFixed(1)}° elevation
          {data && data.sun.visibilityClearanceDeg <= 0
            ? " · below horizon"
            : ""}
        </span>
      </div>
      <div className="scene-label earth-label" ref={earthLabel}>
        ◉ EARTH{" "}
        <span>
          {data?.earth.elevationDeg.toFixed(1)}° elevation
          {data && data.earth.visibilityClearanceDeg <= 0
            ? " · below horizon"
            : ""}
        </span>
      </div>
      <div className="scene-label station-label" ref={stationLabel}>
        ● <span>{stations[props.station].name}</span>
      </div>
      <div className="view-caption">
        <span>
          {props.view === "planner"
            ? "DRAG TO ROTATE · FIXED SCALE"
            : "DRAG TO LOOK AROUND · SHIFT + SCROLL TO ZOOM"}
        </span>
        <span>{props.view === "planner" ? moonCaption : surfaceCaption}</span>
      </div>
    </>
  );
}
