import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { regolithTexture } from "./surfaceDetails";
import { rad } from "./model";

const moonRadius = 2;
const nasaModelRadius = 0.983;

export const spherical = (lat: number, lon: number, r: number) =>
  new THREE.Vector3(
    r * Math.cos(rad(lat)) * Math.cos(rad(lon)),
    r * Math.sin(rad(lat)),
    -r * Math.cos(rad(lat)) * Math.sin(rad(lon)),
  );

export function disposeObjects(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points))
      return;
    object.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          value.dispose();
          if (
            typeof ImageBitmap !== "undefined" &&
            value.image instanceof ImageBitmap
          ) {
            value.image.close();
          }
        }
      }
      material.dispose();
    }
  });
}

export async function loadTopographicMoon(
  moon: THREE.Group,
  signal: AbortSignal,
) {
  const url =
    import.meta.env.BASE_URL + "assets/Moon_NASA_LRO_8k_Topo_Small.glb";
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error("Could not load NASA's topographic Moon model.");
  const { scene: globe } = await new GLTFLoader().parseAsync(
    await response.arrayBuffer(),
    "",
  );
  if (signal.aborted) {
    disposeObjects(globe);
    return;
  }

  // NASA's mesh is centered on the Moon, with +Y north, +X on the prime
  // meridian and east towards -Z. Scale its nominal radius to the scene.
  globe.scale.setScalar(moonRadius / nasaModelRadius);
  moon.children.forEach(disposeObjects);
  moon.clear();
  moon.add(globe);
  moon.updateWorldMatrix(true, true);
}

export function createObjects(
  scene: THREE.Scene,
  onReady: () => void,
  onIssue: (message: string) => void,
) {
  const manager = new THREE.LoadingManager(onReady, undefined, () =>
    onIssue("Some textures could not load."),
  );
  const loader = new THREE.TextureLoader(manager);
  const texture = loader.load(import.meta.env.BASE_URL + "assets/moon.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  const bump = loader.load(import.meta.env.BASE_URL + "assets/moon-bump.jpg");
  const earthTex = loader.load(import.meta.env.BASE_URL + "assets/earth.jpg");
  earthTex.colorSpace = THREE.SRGBColorSpace;
  const orbitGroup = new THREE.Group();
  const surfaceGroup = new THREE.Group();
  surfaceGroup.visible = false;
  scene.add(orbitGroup, surfaceGroup);
  const moon = new THREE.Group();
  const preview = new THREE.Mesh(
    new THREE.SphereGeometry(moonRadius, 128, 64),
    new THREE.MeshStandardMaterial({
      map: texture,
      bumpMap: bump,
      bumpScale: 0.035,
      roughness: 1,
    }),
  );
  moon.add(preview);
  orbitGroup.add(moon);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xf3f3df }),
  );
  orbitGroup.add(marker);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.058, 40),
    new THREE.MeshBasicMaterial({ color: 0xf3f3df, side: THREE.DoubleSide }),
  );
  marker.add(ring);
  const halo = new THREE.PointLight(0xf3f3df, 0.02, 0.4);
  marker.add(halo);
  const ambient = new THREE.AmbientLight(0xc6c8cc, 0.25);
  scene.add(ambient);
  const sunlight = new THREE.DirectionalLight(0xfff2dd, 3.2);
  sunlight.position.set(-3, 4, 6);
  orbitGroup.add(sunlight);
  const fill = new THREE.DirectionalLight(0x7e9cbf, 0.22);
  fill.position.set(-4, 0, -5);
  orbitGroup.add(fill);
  const starPositions = [];
  let seed = 71;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 300; i++) {
    const v = spherical(
      (Math.asin(random() * 2 - 1) * 180) / Math.PI,
      random() * 360,
      450 + random() * 100,
    );
    starPositions.push(v.x, v.y, v.z);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(starPositions, 3),
  );
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0xa9bdcf,
      size: 1.3,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
    }),
  );
  scene.add(stars);
  const groundGeo = new THREE.PlaneGeometry(650, 650, 180, 180);
  groundGeo.rotateX(-Math.PI / 2);
  const craters = Array.from({ length: 24 }, () => ({
    x: (random() - 0.5) * 500,
    z: (random() - 0.5) * 500,
    r: 8 + random() * 30,
  }));
  const p = groundGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    let y =
      1.5 * Math.sin(x * 0.035) * Math.cos(z * 0.03) +
      0.6 * Math.sin(x * 0.11 + z * 0.06);
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1.5)
        y +=
          -c.r * 0.1 * Math.exp(-d * d * 3) +
          c.r * 0.065 * Math.exp(-Math.pow((d - 0.95) * 7, 2));
    }
    y *= Math.min(1, Math.hypot(x, z) / 25);
    p.setY(i, y - 0.2);
  }
  groundGeo.computeVertexNormals();
  const regolith = regolithTexture();
  const terrain = new THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >(
    groundGeo,
    new THREE.MeshStandardMaterial({
      color: 0xb4b3af,
      map: regolith,
      bumpMap: regolith,
      bumpScale: 0.02,
      roughness: 1,
    }),
  );
  terrain.receiveShadow = true;
  // Local stone shadows stay crisp without kilometre-scale mesh self-shadow acne.
  terrain.castShadow = false;
  surfaceGroup.add(terrain);
  const surfaceLight = new THREE.DirectionalLight(0xffffff, 3.2);
  surfaceLight.castShadow = true;
  surfaceLight.shadow.mapSize.set(2048, 2048);
  surfaceLight.shadow.bias = -0.00002;
  surfaceLight.shadow.normalBias = 0.015;
  surfaceLight.position.set(-80, 35, -80);
  surfaceGroup.add(surfaceLight, surfaceLight.target);
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(6, 64, 32),
    new THREE.MeshStandardMaterial({
      map: earthTex,
      roughness: 1,
      emissive: 0x456780,
      emissiveIntensity: 0.2,
    }),
  );
  surfaceGroup.add(earth);
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(3, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe9aa }),
  );
  surfaceGroup.add(sun);
  const stationMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xf3f3df, depthTest: true }),
  );
  earth.add(stationMarker);

  return {
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
  };
}
