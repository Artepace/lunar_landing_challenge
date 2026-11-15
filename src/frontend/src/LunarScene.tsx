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
import { orbitDistance } from "./orbitFraming";
import { surfaceRocks } from "./surfaceDetails";
import { unpackSurfaceMesh } from "./surfaceTerrain";
import { loadTerrain, type SceneDirections } from "./visibility";

export type Station = keyof typeof stations;
export type View = "orbit" | "surface";
type Props = {
  view: View;
  lat: number;
  lon: number;
  time: number;
  directions?: SceneDirections;
  station: Station;
  command: { target: Body | "reset" };
  onPick: (lat: number, lon: number) => void;
  onFacing: (facing: boolean) => void;
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
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1500);
    const controls = new OrbitControls(camera, renderer.domElement);
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
    let mode: View = "orbit";
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
      camera.near = 0.01;
      camera.updateProjectionMatrix();
      const distance = orbitDistance(
        container.clientWidth,
        container.clientHeight,
      );
      controls.minDistance = controls.maxDistance = distance;
      camera.position.set(5, 1.1, 7.8).normalize().multiplyScalar(distance);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    const look = (body: Body) => {
      yaw = data?.[body].azimuthDeg ?? 0;
      pitch = Math.max(-17, data?.[body].elevationDeg ?? 0);
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
      if (mode === "orbit") {
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
      label.style.left = `${Math.min(container.offsetLeft + x + 12, container.offsetLeft + container.clientWidth - label.offsetWidth - 8)}px`;
      label.style.top = `${container.offsetTop + y - lift}px`;
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
        if (
          current.view === "surface" &&
          (mode !== current.view || changedSite)
        )
          requestTerrain();
        needsRender = true;
      }
      if (mode !== current.view) {
        mode = current.view;
        controls.enabled = mode === "orbit";
        ambient.intensity = mode === "orbit" ? 0.25 : 0.22;
        if (mode === "orbit") {
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
        if (mode === "orbit") reset();
        else look(command.target === "reset" ? "earth" : command.target);
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
      if (mode === "orbit") {
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
        mode === "orbit" &&
          marker.position.dot(camera.position.clone().sub(marker.position)) > 0,
      );
      project(
        sunLabel.current,
        sun,
        mode === "surface" && !flight && sun.visible,
      );
      project(
        earthLabel.current,
        earth,
        mode === "surface" && !flight && earth.visible,
      );
      project(
        stationLabel.current,
        stationMarker,
        mode === "surface" && !flight && earth.visible && facing,
        50,
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
    const up = (event: PointerEvent) => {
      if (drag && !drag.moved && mode === "orbit") {
        const r = renderer.domElement.getBoundingClientRect();
        ray.setFromCamera(
          new THREE.Vector2(
            (2 * (event.clientX - r.left)) / r.width - 1,
            1 - (2 * (event.clientY - r.top)) / r.height,
          ),
          camera,
        );
        const hit = ray.intersectObject(moon, true)[0];
        if (hit) {
          const point = hit.point.normalize();
          latest.current.onPick(
            Math.asin(point.y) / rad(1),
            Math.atan2(-point.z, point.x) / rad(1),
          );
        }
      }
      drag = null;
    };
    const cancel = () => {
      drag = null;
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      setMessage("3D view interrupted. Reload to restore it.");
    };
    container.addEventListener("pointerdown", down);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", up);
    container.addEventListener("pointercancel", cancel);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      modelRequest.abort();
      terrainRequest?.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
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
          props.view === "orbit"
            ? "Interactive Moon. Drag to rotate and click to choose a landing site."
            : "Lunar horizon. Drag to look around."
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
      <div className="scene-label sun-label" ref={sunLabel}>
        ☀ SUN <span>{data?.sun.elevationDeg.toFixed(1)}° elevation</span>
      </div>
      <div className="scene-label earth-label" ref={earthLabel}>
        ◉ EARTH <span>{data?.earth.elevationDeg.toFixed(1)}° elevation</span>
      </div>
      <div className="scene-label station-label" ref={stationLabel}>
        ● <span>{stations[props.station].name}</span>
      </div>
      <div className="view-caption">
        <span>
          {props.view === "orbit"
            ? "DRAG TO ROTATE · FIXED SCALE"
            : "DRAG TO LOOK AROUND"}
        </span>
        <span>{props.view === "orbit" ? moonCaption : surfaceCaption}</span>
      </div>
    </>
  );
}
