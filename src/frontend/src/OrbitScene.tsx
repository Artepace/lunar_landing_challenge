import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ScenePlayer } from "./ScenePlayer";
import { siteCameraFrame } from "./siteCameraFrame";
import { type SceneDirections, type Visibility } from "./visibility";
import { orbitPosition } from "./orbitPosition";
import { earthPreviewRotation } from "./model";

type Props = {
  resetCommand: object;
  lat: number;
  lon: number;
  time: number;
  offset: number;
  playing: boolean;
  directions?: SceneDirections;
  visibility?: Visibility;
  error?: string;
  onOffset: (hours: number) => void;
  onTogglePlay: () => void;
};
export function OrbitScene(props: Props) {
  const { resetCommand, offset, playing, directions, onOffset, onTogglePlay } =
    props;
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef(() => {});
  const [error, setError] = useState("");
  const [backdrop, setBackdrop] = useState<HTMLCanvasElement>();
  const state = useRef(props);
  useEffect(() => {
    state.current = props;
  }, [props]);
  useEffect(() => {
    reset.current();
  }, [resetCommand]);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError("3D rendering is unavailable in this browser.");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x050505, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);
    setBackdrop(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    let controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    // Normal wheel events scroll the document; only Shift + wheel zooms.
    const zoom = (event: WheelEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? container.clientHeight
            : 1;
      // Some browsers convert Shift + wheel into horizontal scrolling.
      const delta = (event.deltaY || event.deltaX) * unit;
      const distance = camera.position.distanceTo(controls.target);
      const next = THREE.MathUtils.clamp(
        distance * Math.exp(THREE.MathUtils.clamp(delta * 0.0015, -0.5, 0.5)),
        controls.minDistance,
        controls.maxDistance,
      );
      camera.position
        .sub(controls.target)
        .multiplyScalar(next / distance)
        .add(controls.target);
      controls.update();
    };
    renderer.domElement.addEventListener("wheel", zoom, { passive: false });
    controls.minDistance = 8;
    controls.maxDistance = 100;
    reset.current = () => {
      controls.target.set(0, 0, 0);
      const frame = siteCameraFrame(state.current.lat, state.current.lon);
      camera.up.fromArray(frame.up);
      camera.position
        .fromArray(frame.direction)
        .multiplyScalar(Math.min(90, 37 * Math.max(1, 1 / camera.aspect)));
      // Recreate controls so their cached up-frame follows the selected site.
      controls.dispose();
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.enableZoom = false;
      controls.minDistance = 8;
      controls.maxDistance = 100;
      controls.update();
    };
    const resources: { dispose: () => void }[] = [];
    const own = <T extends { dispose: () => void }>(item: T): T => {
      resources.push(item);
      return item;
    };
    const sphere = (radius: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(
        own(new THREE.SphereGeometry(radius, 48, 32)),
        own(material),
      );
      scene.add(mesh);
      return mesh;
    };
    const sun = sphere(0.85, new THREE.MeshBasicMaterial({ color: 0xffd68a }));
    const sunlight = new THREE.DirectionalLight(0xfff1d6, 3);
    scene.add(sunlight, new THREE.AmbientLight(0x9bb7df, 0.35));
    const earth = sphere(
      0.68,
      new THREE.MeshStandardMaterial({ color: 0x92bfff, roughness: 0.9 }),
    );
    const moon = sphere(
      2,
      new THREE.MeshStandardMaterial({ color: 0xc5c7ce, roughness: 1 }),
    );
    let disposed = false;
    const loader = new THREE.TextureLoader();
    for (const [mesh, file] of [
      [earth, "earth.jpg"],
      [moon, "moon.jpg"],
    ] as const) {
      own(
        loader.load(`${import.meta.env.BASE_URL}assets/${file}`, (loaded) => {
          if (disposed) {
            loaded.dispose();
            return;
          }
          loaded.colorSpace = THREE.SRGBColorSpace;
          const material = mesh.material as THREE.MeshStandardMaterial;
          material.map = loaded;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        }),
      );
    }
    const marker = sphere(
      0.07,
      new THREE.MeshBasicMaterial({ color: 0xeddfa8 }),
    );
    const paths = [0xffd68a, 0x7ca9cf].map((color) => {
      const geometry = own(new THREE.BufferGeometry());
      const line = new THREE.Line(
        geometry,
        own(
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.55,
          }),
        ),
      );
      scene.add(line);
      return line;
    });
    let lastSeries: Visibility | undefined;
    let lastSite = "";
    const starPositions = new Float32Array(1200 * 3);
    for (let i = 0; i < 1200; i++) {
      const y = 1 - 2 * ((i + 0.5) / 1200),
        angle = i * 2.399963,
        r = Math.sqrt(1 - y * y);
      starPositions.set(
        [100 * r * Math.cos(angle), 100 * y, 100 * r * Math.sin(angle)],
        i * 3,
      );
    }
    const stars = own(new THREE.BufferGeometry());
    stars.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    scene.add(
      new THREE.Points(
        stars,
        own(
          new THREE.PointsMaterial({
            color: 0xa09f9a,
            size: 0.08,
            transparent: true,
            opacity: 0.55,
          }),
        ),
      ),
    );
    const labels = ["SUN", "EARTH", "LANDING SITE"].map((text) => {
      const label = document.createElement("span");
      label.className = "orbital-body-label";
      label.textContent = text;
      container.appendChild(label);
      return label;
    });
    const resize = () => {
      const width = container.clientWidth,
        height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    reset.current();
    let frame = 0;
    const point = new THREE.Vector3();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (document.hidden) return;
      const current = state.current;
      const { lat, lon, directions, visibility } = current;
      const siteKey = `${lat}/${lon}`;
      if (visibility !== lastSeries || siteKey !== lastSite) {
        if (siteKey !== lastSite) reset.current();
        lastSeries = visibility;
        lastSite = siteKey;
        marker.position.fromArray(orbitPosition(lat, lon, 0, 90, 0.03));
        paths.forEach((path, index) => {
          const body = index === 0 ? "sun" : "earth";
          const points =
            visibility?.samples.map(
              (sample) =>
                new THREE.Vector3(
                  ...orbitPosition(
                    lat,
                    lon,
                    sample[body].azimuthDeg,
                    sample[body].elevationDeg,
                    index === 0 ? 14 : 10,
                  ),
                ),
            ) ?? [];
          path.geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
              points.flatMap((point) => point.toArray()),
              3,
            ),
          );
          if (points.length) path.geometry.computeBoundingSphere();
          path.visible = points.length > 0;
        });
      }
      sun.visible = earth.visible = Boolean(directions);
      sunlight.intensity = directions ? 3 : 0;
      if (directions) {
        sun.position.fromArray(
          orbitPosition(
            lat,
            lon,
            directions.sun.azimuthDeg,
            directions.sun.elevationDeg,
            14,
          ),
        );
        earth.position.fromArray(
          orbitPosition(
            lat,
            lon,
            directions.earth.azimuthDeg,
            directions.earth.elevationDeg,
            10,
          ),
        );
        sunlight.position.copy(sun.position).sub(marker.position);
        earth.rotation.y = earthPreviewRotation(current.time) + Math.PI;
      }
      controls.update();
      camera.updateMatrixWorld();
      [
        sun.position,
        earth.position,
        marker.position.clone().add(new THREE.Vector3(0, 0.2, 0)),
      ].forEach((position, index) => {
        point.copy(position).project(camera);
        labels[index].hidden =
          (index < 2 && !directions) ||
          Math.abs(point.z) > 1 ||
          Math.abs(point.x) > 1 ||
          Math.abs(point.y) > 1;
        labels[index].style.left =
          `${(point.x * 0.5 + 0.5) * container.clientWidth}px`;
        // Screen-space clearance stays consistent as the camera rotates/zooms.
        const depth = -position.clone().applyMatrix4(camera.matrixWorldInverse)
          .z;
        const radius = index === 0 ? 0.85 : index === 1 ? 0.68 : 0;
        const gap =
          index < 2
            ? (radius * container.clientHeight) /
                (2 *
                  Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
                  Math.max(depth, camera.near)) +
              18
            : 0;
        labels[index].style.top =
          `${(-point.y * 0.5 + 0.5) * container.clientHeight - gap}px`;
      });
      renderer.render(scene, camera);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      setBackdrop(undefined);
      setError("3D view interrupted. Reload to restore it.");
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("wheel", zoom);
      resources.forEach((resource) => resource.dispose());
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose();
      renderer.domElement.remove();
      labels.forEach((label) => label.remove());
      reset.current = () => {};
    };
  }, []);
  return (
    <>
      <div
        className="orbital-scene"
        ref={host}
        role="img"
        aria-label="Moon-centered view of the same Sun and Earth positions as Surface. Drag to rotate. Hold Shift and scroll to zoom."
      />
      <div className="orbital-heading hero-copy">
        <span className="eyebrow">A VIEW FROM SPACE</span>
        <h1>
          From the Moon.
          <br />
          <em>See the motion.</em>
        </h1>
        <p>The same sky as Surface, seen from space.</p>
        <p>Drag to rotate · Shift + scroll to zoom</p>
      </div>
      {(error || !directions) && (
        <div id="loading" role="status">
          {error ||
            props.error ||
            "Loading the shared Sun and Earth positions…"}
        </div>
      )}
      <ScenePlayer
        backdrop={backdrop}
        distortionScale={-220}
        greenOffset={20}
        time={props.time}
        offset={offset}
        playing={playing}
        disabled={!directions || !!error}
        onOffset={onOffset}
        onTogglePlay={onTogglePlay}
        note="Shared with Surface · Sun and Earth paths over 72 hours · Sizes and distances exaggerated"
      />
    </>
  );
}
