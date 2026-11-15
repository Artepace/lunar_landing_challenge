import * as THREE from "three";

// Procedural regolith: fine grains, broad albedo variation and shallow pits.
// This is visual detail, not a change to measured LOLA elevations.
export function regolithTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x: number, y: number, cells: number) => {
    const gx = (x / size) * cells,
      gy = (y / size) * cells;
    const ix = Math.floor(gx),
      iy = Math.floor(gy);
    const fx = gx - ix,
      fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix % cells, iy % cells),
      b = hash((ix + 1) % cells, iy % cells);
    const c = hash(ix % cells, (iy + 1) % cells),
      d = hash((ix + 1) % cells, (iy + 1) % cells);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(a, b, sx),
      THREE.MathUtils.lerp(c, d, sx),
      sy,
    );
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const shade =
        125 +
        noise(x, y, 8) * 24 +
        noise(x, y, 32) * 22 +
        noise(x, y, 128) * 18 +
        hash(x, y) * 30;
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = shade;
      image.data[i + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  // The same repeat scale on measured and fallback ground keeps grains in metres.
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(85, 85);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function surfaceRocks(terrain: THREE.Mesh, unit: number) {
  const group = new THREE.Group();
  group.scale.setScalar(unit);
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const vertices = geometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i),
      y = vertices.getY(i),
      z = vertices.getZ(i);
    const n = 1 + 0.15 * Math.sin(x * 13 + y * 23 + z * 17);
    vertices.setXYZ(i, x * n, y * n, z * n);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0x8a8986,
    roughness: 1,
    flatShading: true,
  });
  const rocks = new THREE.InstancedMesh(geometry, material, 240);
  rocks.castShadow = rocks.receiveShadow = true;
  const sampleGeometry = new THREE.BufferGeometry();
  sampleGeometry.setAttribute(
    "position",
    terrain.geometry.getAttribute("position"),
  );
  const bearings = terrain.geometry.userData.bearings;
  // Only the nearest rings are needed for small foreground stones.
  const index = terrain.geometry.getIndex()!;
  sampleGeometry.setIndex(
    new THREE.BufferAttribute(
      bearings ? index.array.slice(0, bearings * 27) : index.array,
      1,
    ),
  );
  const sampler = new THREE.Mesh(
    sampleGeometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  sampler.updateMatrixWorld();
  const ray = new THREE.Raycaster(),
    dummy = new THREE.Object3D();
  let seed = 83,
    count = 0;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 240; i++) {
    const angle = random() * Math.PI * 2,
      distance = 2 + Math.pow(random(), 0.8) * 52;
    const x = Math.sin(angle) * distance,
      z = Math.cos(angle) * distance;
    ray.set(
      new THREE.Vector3(x * unit, 1000 * unit, z * unit),
      new THREE.Vector3(0, -1, 0),
    );
    const hit = ray.intersectObject(sampler)[0];
    if (!hit) continue;
    const size = 0.035 + Math.pow(random(), 3) * 0.8;
    dummy.position.set(x, hit.point.y / unit + size * 0.22, z);
    dummy.rotation.set(random() * 0.3, random() * Math.PI, random() * 0.3);
    dummy.scale.set(
      size * (0.8 + random() * 0.6),
      size * (0.35 + random() * 0.35),
      size,
    );
    dummy.updateMatrix();
    rocks.setMatrixAt(count, dummy.matrix);
    rocks.setColorAt(count, new THREE.Color().setScalar(0.55 + random() * 0.4));
    count++;
  }
  rocks.count = count;
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  sampleGeometry.dispose();
  sampler.material.dispose();
  group.add(rocks);
  return group;
}
