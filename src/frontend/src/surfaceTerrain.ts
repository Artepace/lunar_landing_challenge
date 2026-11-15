import * as THREE from "three";

export function unpackSurfaceMesh(buffer: ArrayBuffer) {
  const data = new DataView(buffer);
  if (data.byteLength < 8) throw new Error("Incomplete terrain mesh.");
  const rings = data.getUint32(0, true);
  const bearings = data.getUint32(4, true);
  const count = 1 + rings * bearings;
  if (rings < 1 || bearings < 3 || data.byteLength !== 8 + count * 12) {
    throw new Error("Invalid terrain mesh dimensions.");
  }

  const vertices = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let index = 0; index < count; index++) {
    const offset = 8 + index * 12;
    const x = data.getFloat32(offset, true);
    const y = data.getFloat32(offset + 4, true);
    const z = data.getFloat32(offset + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error("Invalid terrain vertex.");
    }
    vertices.set([x, y, z], index * 3);
    // Match the fallback ground texture's scale, converting kilometers to meters.
    uv.set([(x * 1_000) / 650, (-z * 1_000) / 650], index * 2);
  }

  const indices = new Uint32Array(bearings * (3 + (rings - 1) * 6));
  for (let bearing = 0; bearing < bearings; bearing++) {
    const next = (bearing + 1) % bearings;
    indices.set([0, 1 + next, 1 + bearing], bearing * 3);
  }
  let offset = bearings * 3;
  for (let ring = 1; ring < rings; ring++) {
    const inner = 1 + (ring - 1) * bearings;
    const outer = inner + bearings;
    for (let bearing = 0; bearing < bearings; bearing++) {
      const next = (bearing + 1) % bearings;
      indices.set(
        [
          inner + bearing,
          inner + next,
          outer + bearing,
          inner + next,
          outer + next,
          outer + bearing,
        ],
        offset,
      );
      offset += 6;
    }
  }

  const mesh = new THREE.BufferGeometry();
  mesh.userData.bearings = bearings;
  mesh.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  mesh.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  mesh.setIndex(new THREE.BufferAttribute(indices, 1));
  mesh.computeVertexNormals();
  return mesh;
}
