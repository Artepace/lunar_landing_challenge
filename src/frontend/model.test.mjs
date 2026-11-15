import test from 'node:test';
import assert from 'node:assert/strict';
import { directionsAt, visibilityWindows } from './src/visibility.ts';
import { unpackSurfaceMesh } from './src/surfaceTerrain.ts';

const direction = (azimuthDeg, visibilityClearanceDeg) => ({
  azimuthDeg,
  elevationDeg: 1,
  horizonElevationDeg: 2,
  visibilityClearanceDeg,
});
const samples = [
  { earth: direction(359, -1), sun: { ...direction(85, 1), visibleFraction: 0.9 } },
  { earth: direction(1, 1), sun: { ...direction(86, -1), visibleFraction: 0 } },
  { earth: direction(2, -1), sun: { ...direction(87, -1), visibleFraction: 0 } },
];
const series = { stepMinutes: 15, samples };

test('the scrubber wraps azimuth at north and interpolates visibility', () => {
  const halfway = directionsAt(series, 0.125).earth;
  assert.equal(halfway.azimuthDeg, 0);
  assert.equal(halfway.visibilityClearanceDeg, 0);
  assert.equal(directionsAt(series, 0.5).earth.azimuthDeg, 2);
});

test('visibility intervals and crossings use the terrain clearance', () => {
  assert.deepEqual(visibilityWindows(series, 'earth'), {
    intervals: [[0.125, 0.375]],
    crossings: [{ hours: 0.125, setting: false }, { hours: 0.375, setting: true }],
  });
  assert.deepEqual(visibilityWindows(series, 'sun'), {
    intervals: [[0, 0.125]],
    crossings: [{ hours: 0.125, setting: true }],
  });
});

test('surface mesh wraps each terrain ring and faces up toward the observer', () => {
  const vertices = [0, 0, 0, 0, 0, -1, 1, 0, 0, 0, 0, 1, -1, 0, 0,
    0, 0, -2, 2, 0, 0, 0, 0, 2, -2, 0, 0];
  const buffer = new ArrayBuffer(8 + vertices.length * 4);
  const data = new DataView(buffer);
  data.setUint32(0, 2, true);
  data.setUint32(4, 4, true);
  vertices.forEach((value, index) => data.setFloat32(8 + index * 4, value, true));
  const mesh = unpackSurfaceMesh(buffer);
  assert.equal(mesh.getAttribute('position').count, 9);
  assert.equal(mesh.getIndex().count, 36);
  assert.deepEqual([...mesh.getIndex().array.slice(-6)], [4, 1, 8, 1, 5, 8]);
  assert(mesh.getAttribute('normal').array.every((value, index) => value === (index % 3 === 1 ? 1 : 0)));
  assert.throws(() => unpackSurfaceMesh(buffer.slice(0, -4)), /Invalid terrain mesh dimensions/);
  mesh.dispose();
});

test('fixed orbit framing keeps the globe inside portrait and landscape viewports', async () => {
  const { orbitDistance } = await import('./src/orbitFraming.ts');
  for (const [width, height] of [[320,600], [600,320], [600,600]]) {
    const distance = orbitDistance(width,height);
    const angularRadius = Math.asin(2/distance);
    const vertical = Math.tan(angularRadius)/Math.tan(42*Math.PI/360);
    const horizontal = vertical/(width/height);
    assert(vertical <= .821 && horizontal <= .821, 'the full disk must have room around it');
    assert(Math.max(vertical,horizontal) > .8, 'the disk should retain its intended scale');
  }
});

test('foreground rocks stay grounded at both metre and kilometre terrain scales', async () => {
  const THREE = await import('three');
  const { surfaceRocks } = await import('./src/surfaceDetails.ts');
  for(const unit of [1, .001]) {
    const geometry = new THREE.PlaneGeometry(150*unit,150*unit,2,2);
    geometry.rotateX(-Math.PI/2); geometry.translate(0,3*unit,0);
    const terrain = new THREE.Mesh(geometry);
    const details = surfaceRocks(terrain,unit);
    const rocks = details.children[0];
    assert.equal(rocks.count,240);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    for(let i=0;i<rocks.count;i++) {
      rocks.getMatrixAt(i,matrix); position.setFromMatrixPosition(matrix);
      assert(position.y > 3 && position.y < 3.25);
    }
    assert.equal(details.scale.x,unit);
    rocks.geometry.dispose(); rocks.material.dispose(); geometry.dispose(); terrain.material.dispose();
  }
});

test('Moon-centered positions preserve Surface sightlines at equator and poles', async () => {
  const { orbitPosition } = await import('./src/orbitPosition.ts');
  const radians = Math.PI / 180;
  for (const [lat, lon] of [[0, 0], [-89.5, 30], [90, 180], [-90, -90], [45, -120]]) {
    const p = lat * radians, l = lon * radians;
    const up = [Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l)];
    const north = [-Math.sin(p) * Math.cos(l), Math.cos(p), Math.sin(p) * Math.sin(l)];
    const east = [-Math.sin(l), 0, -Math.cos(l)];
    const site = orbitPosition(lat, lon, 0, 0, 0);
    for (const az of [0, 90, 180, 270, 359]) for (const el of [-30, 0, 45, 90]) {
      const position = orbitPosition(lat, lon, az, el, 14);
      const direction = position.map((v, i) => (v - site[i]) / 14);
      const dot = (basis) => direction.reduce((sum, v, i) => sum + v * basis[i], 0);
      assert(Math.abs(dot(up) - Math.sin(el * radians)) < 1e-12);
      assert(Math.abs(dot(north) - Math.cos(el * radians) * Math.cos(az * radians)) < 1e-12);
      assert(Math.abs(dot(east) - Math.cos(el * radians) * Math.sin(az * radians)) < 1e-12);
    }
  }
});

test('site camera centers the landing marker with a stable up direction, including poles', async () => {
  const { siteCameraFrame } = await import('./src/siteCameraFrame.ts');
  const { orbitPosition } = await import('./src/orbitPosition.ts');
  const { PerspectiveCamera, Vector3 } = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  for (const [lat, lon] of [[-89.5, 30], [0, 0], [90, 180], [-90, -90], [45, -120]]) {
    const frame = siteCameraFrame(lat, lon);
    const camera = new PerspectiveCamera(45, 1, 0.01, 500);
    camera.up.fromArray(frame.up);
    camera.position.fromArray(frame.direction).multiplyScalar(37);
    const controls = new OrbitControls(camera, null);
    controls.update();
    camera.updateMatrixWorld();
    const marker = new Vector3(...orbitPosition(lat, lon, 0, 90, 0.03));
    const projected = marker.project(camera);
    assert(Math.abs(projected.x) < 1e-10);
    assert(Math.abs(projected.y) < 1e-10);
    assert(projected.z > -1 && projected.z < 1);
    assert(Math.abs(new Vector3(...frame.direction).dot(new Vector3(...frame.up))) < 1e-12);
  }
});
