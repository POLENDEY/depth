import * as THREE from "three";
import type { Pt } from "./clicker-layout";
import { maskRings } from "./logo";
import { repairMesh, type MeshRepair } from "./mesh-repair";

// Imported models are scaled so their footprint's longer side is this many units; the
// clicker then sizes them in millimeters.
const EXTENT = 100;
const SIDE_RASTER = 256;
const MAX_TRIANGLES = 2_000_000;
const MAX_BYTES = 150 * 1024 * 1024;
// Horizontal slices sampled to find where a switch fits, and their grid.
const GRID = 128;
const LEVELS = 96;

export const MODEL_FORMATS = ".stl,.obj,.glb,.gltf,.3mf";

// Side view along `axis` (the model's thinner horizontal direction): `distance` is how far
// each cell is from empty space, in model units, so a hole can find solid material.
type SideView = {
  axis: "x" | "y";
  minU: number;
  top: number;
  cell: number;
  width: number;
  height: number;
  distance: Float32Array;
};

// Z up, centered on the origin from above, resting on z = 0, its longer side EXTENT units.
export type ImportedModel = {
  name: string;
  positions: Float32Array;
  height: number;
  side: SideView;
  // How the upload was fixed when it wasn't a closed solid, with a rebuild's grid step in
  // model units.
  repair: MeshRepair | null;
  // Turned so a tilted cut lies flat: `frame` takes the upload's model units to these, which
  // are `factor` times as big. Uploads themselves have no frame and a factor of 1.
  frame: THREE.Matrix4 | null;
  factor: number;
};

const models = new Map<string, ImportedModel>();
let counter = 0;

export function importedModel(id: string) {
  return models.get(id) ?? null;
}

export async function importModel(file: File) {
  if (file.size > MAX_BYTES) throw new Error("That file is over 150 MB. Try a smaller or simplified model.");
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  let object: THREE.Object3D;
  let yUp = false;
  if (extension === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    object = new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer()));
  } else if (extension === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    object = new OBJLoader().parse(await file.text());
    yUp = true;
  } else if (extension === "glb" || extension === "gltf") {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const data = extension === "glb" ? await file.arrayBuffer() : await file.text();
    try {
      object = (await new GLTFLoader().parseAsync(data, "")).scene;
    } catch {
      throw new Error("Could not read that glTF. If it uses separate .bin or texture files, export it as a single .glb.");
    }
    yUp = true;
  } else if (extension === "3mf") {
    const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
    object = new ThreeMFLoader().parse(await file.arrayBuffer());
  } else {
    throw new Error("Upload an STL, OBJ, GLB, glTF, or 3MF file.");
  }
  object.updateMatrixWorld(true);
  const chunks: Float32Array[] = [];
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute("position")) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    if (yUp) geometry.rotateX(Math.PI / 2);
    chunks.push(Float32Array.from(geometry.getAttribute("position").array));
    geometry.dispose();
  });
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!total) throw new Error("That file has no 3D surfaces in it.");
  if (total / 9 > MAX_TRIANGLES) throw new Error("That model has over 2 million triangles. Simplify it and upload it again.");
  const positions = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    positions.set(chunk, at);
    at += chunk.length;
  }
  const repaired = await repairMesh(positions);
  return registerModel(file.name.replace(/\.[^.]+$/, ""), repaired.positions, repaired.repair);
}

export function registerModel(name: string, raw: Float32Array, repair: MeshRepair | null = null) {
  const box = new THREE.Box3().setFromArray(raw);
  const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
  if (!(span > 0) || !(box.max.z > box.min.z)) throw new Error("That model is flat or empty. Upload a solid 3D object.");
  const scale = EXTENT / span;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const positions = new Float32Array(raw.length);
  for (let index = 0; index < raw.length; index += 3) {
    positions[index] = (raw[index] - cx) * scale;
    positions[index + 1] = (raw[index + 1] - cy) * scale;
    positions[index + 2] = (raw[index + 2] - box.min.z) * scale;
  }
  const model: ImportedModel = {
    name,
    positions,
    height: (box.max.z - box.min.z) * scale,
    side: sideView(positions),
    repair: repair?.kind === "rebuilt" ? { kind: "rebuilt", detail: repair.detail * scale } : repair,
    frame: null,
    factor: 1,
  };
  const id = `model-${++counter}`;
  models.set(id, model);
  return id;
}

// The cut's normal (pointing into the cap) for a tilt from flat and a turn around the
// vertical, in degrees.
export function cutNormal(tilt: number, turn: number) {
  const t = (tilt * Math.PI) / 180;
  const p = (turn * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t));
}

export function isTiltedCut(tilt: number) {
  return Math.abs(tilt) % 360 > 1e-6;
}

// The model turned so a cut at this tilt and turn is flat, as its own model: centered from
// above, resting on z = 0, and scaled so its footprint fits the grid. A flat cut is the model.
export function cutFrameModel(id: string, tilt: number, turn: number) {
  if (!isTiltedCut(tilt)) return id;
  const key = `${id}@${tilt.toFixed(2)}:${turn.toFixed(2)}`;
  if (models.has(key)) return key;
  const source = models.get(id);
  if (!source) throw new Error("That 3D model is no longer loaded. Upload it again.");
  const turnUp = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(cutNormal(tilt, turn), new THREE.Vector3(0, 0, 1)),
  );
  const turned = Float32Array.from(source.positions);
  new THREE.BufferAttribute(turned, 3).applyMatrix4(turnUp);
  const box = new THREE.Box3().setFromArray(turned);
  const factor = EXTENT / Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
  const frame = new THREE.Matrix4()
    .makeTranslation(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z)
    .premultiply(new THREE.Matrix4().makeScale(factor, factor, factor))
    .multiply(turnUp);
  const positions = Float32Array.from(source.positions);
  new THREE.BufferAttribute(positions, 3).applyMatrix4(frame);
  models.set(key, {
    name: source.name,
    positions,
    height: (box.max.z - box.min.z) * factor,
    side: sideView(positions),
    repair: source.repair,
    frame,
    factor,
  });
  return key;
}

// Fills every triangle's projection into a `width` x `height` mask; (u, v) picks the axes.
function rasterize(
  positions: Float32Array,
  u: number,
  v: number,
  minU: number,
  maxV: number,
  cell: number,
  width: number,
  height: number,
) {
  const mask = new Uint8Array(width * height);
  const px = (value: number) => (value - minU) / cell - 0.5;
  const py = (value: number) => (maxV - value) / cell - 0.5;
  const mark = (x: number, y: number) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix >= 0 && iy >= 0 && ix < width && iy < height) mask[iy * width + ix] = 1;
  };
  for (let index = 0; index < positions.length; index += 9) {
    const ax = px(positions[index + u]);
    const ay = py(positions[index + v]);
    const bx = px(positions[index + 3 + u]);
    const by = py(positions[index + 3 + v]);
    const cx = px(positions[index + 6 + u]);
    const cy = py(positions[index + 6 + v]);
    mark(ax, ay);
    mark(bx, by);
    mark(cx, cy);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
        const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
        if (w0 >= -1e-6 && w1 >= -1e-6 && w0 + w1 <= 1 + 1e-6) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

function sideView(positions: Float32Array): SideView {
  const box = new THREE.Box3().setFromArray(positions);
  // Bored across the thinner way, so the hole is short and the ring hangs flat.
  const axis = box.max.x - box.min.x <= box.max.y - box.min.y ? "x" : "y";
  const u = axis === "x" ? 1 : 0;
  const minU = axis === "x" ? box.min.y : box.min.x;
  const maxU = axis === "x" ? box.max.y : box.max.x;
  const cell = Math.max(maxU - minU, box.max.z) / SIDE_RASTER;
  const width = Math.ceil((maxU - minU) / cell) + 1;
  const height = Math.ceil(box.max.z / cell) + 1;
  const mask = rasterize(positions, u, 2, minU, box.max.z, cell, width, height);
  // Two-pass chamfer distance to the nearest empty cell or edge, in cells.
  const distance = new Float32Array(width * height);
  const far = 1e9;
  for (let index = 0; index < mask.length; index += 1) distance[index] = mask[index] ? far : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : distance[y * width + x]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!distance[index]) continue;
      distance[index] = Math.min(distance[index], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (!distance[index]) continue;
      distance[index] = Math.min(distance[index], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
  }
  for (let index = 0; index < distance.length; index += 1) distance[index] *= cell;
  return { axis, minU, top: box.max.z, cell, width, height, distance };
}

// How much material surrounds (u, v) seen from the side, in model units; 0 outside.
export function sideRoom(model: ImportedModel, u: number, v: number) {
  const { side } = model;
  const x = Math.floor((u - side.minU) / side.cell);
  const y = Math.floor((side.top - v) / side.cell);
  if (x < 0 || y < 0 || x >= side.width || y >= side.height) return 0;
  return side.distance[y * side.width + x];
}

// A curved tunnel: a ring of radius `ring` (model units) whose lowest point is at (u, v) in
// the side view, `depth` along the side view's axis. Upright it stands in the side view's
// plane and comes out on top; `tilt` tips it over (90° lies flat) and `turn` spins it
// around the vertical, both in degrees about that lowest point.
export type Tunnel = { axis: "x" | "y"; u: number; v: number; depth?: number; ring: number; tilt: number; turn: number };

// A point on the tunnel's center line, `angle` radians around it (-π/2 is its deepest
// point and π/2 the far side); Infinity gives its center.
export function tunnelPoint(tunnel: Tunnel, angle: number): [number, number, number] {
  const { axis, ring } = tunnel;
  const around = Number.isFinite(angle);
  const across = around ? ring * Math.cos(angle) : 0;
  const depth = tunnel.depth ?? 0;
  let z = ring + (around ? ring * Math.sin(angle) : 0);
  let x = axis === "x" ? 0 : across;
  let y = axis === "x" ? across : 0;
  const tilt = (tunnel.tilt * Math.PI) / 180;
  const turn = (tunnel.turn * Math.PI) / 180;
  // The same Euler steps as the solid: tip about the side view's across axis, then turn.
  if (axis === "x") [x, z] = [x * Math.cos(tilt) + z * Math.sin(tilt), -x * Math.sin(tilt) + z * Math.cos(tilt)];
  else [y, z] = [y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)];
  [x, y] = [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)];
  return axis === "x" ? [x + depth, y + tunnel.u, z + tunnel.v] : [x + tunnel.u, y + depth, z + tunnel.v];
}

// How far along the side view's axis a tipped tunnel slides, from halfway through, toward
// the face it opens on, until the surface is `bridge` model units past its deepest point;
// upright tunnels open on top and stay put.
export function tunnelDepth(model: ImportedModel, tunnel: Tunnel, bridge: number) {
  const start = { ...tunnel, depth: 0 };
  const deepest = tunnelPoint(start, -Math.PI / 2);
  const far = tunnelPoint(start, Math.PI / 2);
  const reach = Math.hypot(far[0] - deepest[0], far[1] - deepest[1], far[2] - deepest[2]) || 1;
  const out = far.map((value, index) => (value - deepest[index]) / reach);
  const along = out[tunnel.axis === "x" ? 0 : 1];
  if (Math.abs(along) < 0.2) return 0;
  const step = Math.sign(along) * GRID_CELL * 0.5;
  let depth = 0;
  for (let moved = 0; moved < GRID; moved += 1) {
    const at = tunnelPoint({ ...tunnel, depth }, -Math.PI / 2);
    if (!insideModel(model, at[0], at[1], at[2])) return moved ? depth - step : 0;
    if (!insideModel(model, at[0] + out[0] * bridge, at[1] + out[1] * bridge, at[2] + out[2] * bridge)) return depth;
    depth += step;
  }
  return 0;
}

// Whether a point (model units) is inside the model, to the volume grid's detail.
export function insideModel(model: ImportedModel, x: number, y: number, z: number) {
  const volume = volumeOf(model);
  const ix = Math.round((x - GRID_MIN) / GRID_CELL - NUDGE.x);
  const iy = Math.round((y - GRID_MIN) / GRID_CELL - NUDGE.y);
  const level = Math.floor(z / volume.step);
  if (ix < 0 || iy < 0 || ix >= GRID || iy >= GRID || level < 0 || level >= LEVELS) return false;
  return volume.inside[level][iy * GRID + ix] === 1;
}

// How much of the tunnel's center line runs through the model (0 to 1), and its lowest and
// highest points.
export function tunnelReach(model: ImportedModel, tunnel: Tunnel) {
  const samples = 72;
  let inside = 0;
  let low = Infinity;
  let high = -Infinity;
  for (let step = 0; step < samples; step += 1) {
    const [x, y, z] = tunnelPoint(tunnel, (step / samples) * Math.PI * 2);
    if (insideModel(model, x, y, z)) inside += 1;
    low = Math.min(low, z);
    high = Math.max(high, z);
  }
  return { share: inside / samples, low, high };
}

// The highest spot (where a keyring hangs naturally) with `need` model units of material
// all around, nearest the middle and clear of the `avoid` heights; or the most solid spot
// when nothing is thick enough.
export function autoHole(model: ImportedModel, need: number, avoid: [number, number] = [0, 0]) {
  const { side } = model;
  let best: { u: number; v: number; score: number } | null = null;
  let thickest = { u: 0, v: model.height / 2, room: -1 };
  const middle = side.minU + (side.width * side.cell) / 2;
  for (let y = 0; y < side.height; y += 1) {
    for (let x = 0; x < side.width; x += 1) {
      const room = side.distance[y * side.width + x];
      const u = side.minU + (x + 0.5) * side.cell;
      const v = side.top - (y + 0.5) * side.cell;
      if (room > thickest.room) thickest = { u, v, room };
      if (room < need || (v + need > avoid[0] && v - need < avoid[1])) continue;
      const score = v * 1000 - Math.abs(u - middle);
      if (!best || score > best.score) best = { u, v, score };
    }
  }
  return best ? { u: best.u, v: best.v, fits: true } : { u: thickest.u, v: thickest.v, fits: false };
}

// How a switch hides inside a model cut in two, in mm. The switch holds the cap `travel`
// above the housing, so pressing it closes the gap (the object's own shape) as the switch
// bottoms out. Below the cut the housing has a pocket with the switch plate at its floor;
// the cap's plug hangs into it, hollow around the switch, with the stem socket inside.
export const CUT = {
  // Floor, pin cavity, and plate under the switch, as in the other clickers.
  base: 11.1,
  // Half the 15.2 mm pin cavity plus its 1.6 mm wall.
  baseHalf: 9.2,
  floor: 1.6,
  wall: 2,
  gap: 0.3,
  // Below the cap's cut face: 2.4 mm stays in the pocket with the cap up, and it reaches
  // 0.3 mm over the plate when pressed.
  plug: 6.7,
  // The gap under the cap at rest: 4 mm of key travel and 0.3 mm to spare.
  travel: 4.3,
  hollow: 16.4,
  capWall: 1.2,
  // The hollow's top over the cut face; the stem's top sits 0.3 mm under it with the cap up.
  ceiling: 0.9,
  // Housing-colored bands just under and just over the cut.
  rim: 2,
  border: 1.2,
};

export const MAX_SIZE = 300;
const CUT_SAMPLES = 40;
const LOWEST_CUT = CUT.base + CUT.plug;
const GRID_SPAN = EXTENT + 4;
const GRID_MIN = -GRID_SPAN / 2;
const GRID_CELL = GRID_SPAN / GRID;
// Cell centers sit just off the grid so they never land exactly on a shared triangle edge.
const NUDGE = { x: 0.5137, y: 0.5071 };

export function plateHeight(cut: number) {
  return cut - CUT.plug;
}

// The solid in horizontal slices: per level, which grid cells are inside and how far each
// is from empty space measured square-wise (model units), so a square of half-width s fits
// centered on a cell when its room is at least s.
type Volume = { step: number; inside: Uint8Array[]; room: Float32Array[] };
const volumes = new WeakMap<ImportedModel, Volume>();

function volumeOf(model: ImportedModel): Volume {
  const cached = volumes.get(model);
  if (cached) return cached;
  const cells = GRID * GRID;
  const { positions } = model;
  // Every place a vertical line through a cell center crosses the surface.
  const visit = (hit: (index: number, z: number) => void) => {
    for (let t = 0; t < positions.length; t += 9) {
      const ax = (positions[t] - GRID_MIN) / GRID_CELL - NUDGE.x;
      const ay = (positions[t + 1] - GRID_MIN) / GRID_CELL - NUDGE.y;
      const bx = (positions[t + 3] - GRID_MIN) / GRID_CELL - NUDGE.x;
      const by = (positions[t + 4] - GRID_MIN) / GRID_CELL - NUDGE.y;
      const cx = (positions[t + 6] - GRID_MIN) / GRID_CELL - NUDGE.x;
      const cy = (positions[t + 7] - GRID_MIN) / GRID_CELL - NUDGE.y;
      const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx)));
      const x1 = Math.min(GRID - 1, Math.floor(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy)));
      const y1 = Math.min(GRID - 1, Math.floor(Math.max(ay, by, cy)));
      if (x0 > x1 || y0 > y1) continue;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
          const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          hit(y * GRID + x, w0 * positions[t + 2] + w1 * positions[t + 5] + w2 * positions[t + 8]);
        }
      }
    }
  };
  const offsets = new Uint32Array(cells + 1);
  visit((index) => {
    offsets[index + 1] += 1;
  });
  for (let index = 0; index < cells; index += 1) offsets[index + 1] += offsets[index];
  const heights = new Float32Array(offsets[cells]);
  const cursor = offsets.slice(0, cells);
  visit((index, z) => {
    heights[cursor[index]++] = z;
  });
  const step = model.height / LEVELS;
  const inside = Array.from({ length: LEVELS }, () => new Uint8Array(cells));
  for (let index = 0; index < cells; index += 1) {
    const end = offsets[index + 1];
    heights.subarray(offsets[index], end).sort();
    let crossed = offsets[index];
    for (let level = 0; level < LEVELS; level += 1) {
      const z = (level + 0.5) * step;
      while (crossed < end && heights[crossed] < z) crossed += 1;
      inside[level][index] = (crossed - offsets[index]) & 1;
    }
  }
  const volume = { step, inside, room: inside.map(squareRoom) };
  volumes.set(model, volume);
  return volume;
}

// Two-pass chessboard distance to the nearest empty cell or the grid edge.
function squareRoom(mask: Uint8Array) {
  const distance = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) distance[index] = mask[index] ? 1e9 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= GRID || y >= GRID ? 0 : distance[y * GRID + x]);
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const index = y * GRID + x;
      if (distance[index]) distance[index] = Math.min(distance[index], at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1, at(x + 1, y - 1) + 1);
    }
  }
  for (let y = GRID - 1; y >= 0; y -= 1) {
    for (let x = GRID - 1; x >= 0; x -= 1) {
      const index = y * GRID + x;
      if (distance[index]) distance[index] = Math.min(distance[index], at(x + 1, y) + 1, at(x + 1, y + 1) + 1, at(x, y + 1) + 1, at(x - 1, y + 1) + 1);
    }
  }
  for (let index = 0; index < distance.length; index += 1) {
    distance[index] = distance[index] ? (distance[index] - 0.5) * GRID_CELL : -GRID_CELL;
  }
  return distance;
}

function levelRange(volume: Volume, z0: number, z1: number) {
  const clampLevel = (level: number) => Math.min(LEVELS - 1, Math.max(0, level));
  return [clampLevel(Math.floor(z0 / volume.step - 0.5)), clampLevel(Math.ceil(z1 / volume.step - 0.5))];
}

// Lowers each cell's slack to its room minus `need` at every level between z0 and z1.
function narrow(volume: Volume, z0: number, z1: number, need: number, slack: Float32Array) {
  const [from, to] = levelRange(volume, z0, z1);
  for (let level = from; level <= to; level += 1) {
    const room = volume.room[level];
    for (let index = 0; index < slack.length; index += 1) {
      const left = room[index] - need;
      if (left < slack[index]) slack[index] = left;
    }
  }
}

// How much spare room (model units) the switch has centered on each cell for a cut at
// `cut` mm; negative where it doesn't fit.
function switchSlack(volume: Volume, scale: number, cut: number) {
  const unit = (mm: number) => mm / scale;
  const plate = plateHeight(cut);
  // The switch's floor sits under its pins, not at the bottom, so a pointed or tilted
  // bottom only needs material there.
  const floor = plate - CUT.base;
  const slack = new Float32Array(GRID * GRID).fill(Infinity);
  narrow(volume, unit(floor + 0.4), unit(floor + CUT.floor), unit(CUT.baseHalf - 1.6), slack);
  narrow(volume, unit(floor + CUT.floor), unit(plate), unit(CUT.baseHalf), slack);
  narrow(volume, unit(plate), unit(cut), unit(CUT.hollow / 2 + CUT.capWall + CUT.gap + CUT.wall), slack);
  narrow(volume, unit(cut), unit(cut + CUT.ceiling), unit(CUT.hollow / 2 + CUT.capWall), slack);
  narrow(volume, unit(cut + CUT.ceiling), unit(cut + CUT.ceiling + CUT.capWall), unit(CUT.hollow / 2), slack);
  return slack;
}

const cutLists = new Map<string, number[]>();

// Every sampled cut height (mm) with room for the switch at this scale.
function workableCuts(id: string, model: ImportedModel, scale: number) {
  const key = `${id}:${scale.toFixed(5)}`;
  const cached = cutLists.get(key);
  if (cached) return cached;
  const volume = volumeOf(model);
  const highest = model.height * scale - CUT.ceiling - CUT.capWall;
  const cuts: number[] = [];
  if (highest >= LOWEST_CUT) {
    const step = Math.max(0.25, (highest - LOWEST_CUT) / (CUT_SAMPLES - 1));
    for (let cut = LOWEST_CUT; cut <= highest + 1e-6; cut += step) {
      if (switchSlack(volume, scale, cut).some((value) => value >= 0)) cuts.push(cut);
    }
  }
  if (cutLists.size > 200) cutLists.clear();
  cutLists.set(key, cuts);
  return cuts;
}

const smallest = new Map<string, number | null>();

// The smallest size (mm, the longer side from above) with room for a switch, or null when
// even MAX_SIZE is too thin.
export function smallestSize(id: string) {
  if (smallest.has(id)) return smallest.get(id)!;
  const model = models.get(id);
  if (!model) throw new Error("That 3D model is no longer loaded. Upload it again.");
  const fits = (size: number) => workableCuts(id, model, size / EXTENT / model.factor).length > 0;
  let result: number | null = null;
  if (fits(MAX_SIZE)) {
    let low = 10;
    let high = MAX_SIZE;
    if (fits(low)) high = low;
    else {
      while (high - low > 0.5) {
        const middle = (low + high) / 2;
        if (fits(middle)) high = middle;
        else low = middle;
      }
    }
    result = Math.ceil(high);
    while (result < MAX_SIZE && !fits(result)) result += 1;
  }
  smallest.set(id, result);
  return result;
}

export type ClickerPlan = {
  model: ImportedModel;
  // mm per model unit, and the model's size and height in mm.
  scale: number;
  size: number;
  height: number;
  // The cut, every workable cut, and the switch plate's top, in mm from the bottom.
  cut: number;
  cuts: number[];
  plate: number;
  // The switch center in mm, and where it goes on its own in model units.
  at: Pt;
  auto: Pt;
  slack: Float32Array;
};

function cellCenter(index: number): Pt {
  return { x: GRID_MIN + ((index % GRID) + NUDGE.x) * GRID_CELL, y: GRID_MIN + (Math.floor(index / GRID) + NUDGE.y) * GRID_CELL };
}

// Where the switch goes in a model cut at `share` of its height (0 picks a height), at
// `size` mm (clamped to what fits), centered at `switchAt` model units (null: the roomiest spot).
// `allowed` (mm) keeps the switch under the part of the cut that clicks.
export function clickerPlan(
  id: string,
  size: number,
  share: number,
  switchAt: Pt | null,
  allowed?: (x: number, y: number) => boolean,
): ClickerPlan {
  const model = models.get(id);
  if (!model) throw new Error("That 3D model is no longer loaded. Upload it again.");
  const least = smallestSize(id);
  if (least === null) {
    throw new Error(
      `That model is too thin to hide a switch in, even at ${MAX_SIZE} mm. The switch needs about 24 mm square of solid object at the cut, and 25 mm of height.`,
    );
  }
  const fitted = Math.min(MAX_SIZE, Math.max(least, size));
  const scale = fitted / EXTENT / model.factor;
  const height = model.height * scale;
  const cuts = workableCuts(id, model, scale);
  const target = (share > 0 ? share : 0.4) * height;
  const cut = cuts.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best), cuts[0]);
  const slack = switchSlack(volumeOf(model), scale, cut);
  if (allowed) {
    let left = 0;
    for (let index = 0; index < slack.length; index += 1) {
      if (slack[index] < 0) continue;
      const center = cellCenter(index);
      if (allowed(center.x * scale, center.y * scale)) left += 1;
      else slack[index] = -1;
    }
    if (!left) {
      throw new Error("The piece you picked for the cap has no room for the switch at this cut. Pick a bigger piece or move the cut.");
    }
  }
  let best = 0;
  for (let index = 1; index < slack.length; index += 1) if (slack[index] > slack[best]) best = index;
  const auto = cellCenter(best);
  let at = auto;
  if (switchAt) {
    const x = Math.round((switchAt.x - GRID_MIN) / GRID_CELL - NUDGE.x);
    const y = Math.round((switchAt.y - GRID_MIN) / GRID_CELL - NUDGE.y);
    const inGrid = x >= 0 && y >= 0 && x < GRID && y < GRID;
    if (inGrid && slack[y * GRID + x] >= 0) at = switchAt;
    else {
      let nearest = best;
      let distance = Infinity;
      for (let index = 0; index < slack.length; index += 1) {
        if (slack[index] < 0) continue;
        const center = cellCenter(index);
        const away = (center.x - switchAt.x) ** 2 + (center.y - switchAt.y) ** 2;
        if (away < distance) {
          distance = away;
          nearest = index;
        }
      }
      at = cellCenter(nearest);
    }
  }
  return {
    model,
    scale,
    size: fitted,
    height,
    cut,
    cuts,
    plate: plateHeight(cut),
    at: { x: at.x * scale, y: at.y * scale },
    auto,
    slack,
  };
}

function ringArea(ring: Pt[]) {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function gridRings(scale: number, filled: (index: number) => boolean) {
  return maskRings(GRID, GRID, (x, row) => filled((GRID - 1 - row) * GRID + x)).map((ring) =>
    ring.map((point) => ({ x: (GRID_MIN + point.x * GRID_CELL) * scale, y: (GRID_MIN + point.y * GRID_CELL) * scale })),
  );
}

// The model's outline (mm) sliced `z` mm up, and the area the switch center can move in.
export function sliceRings(plan: ClickerPlan, z: number) {
  const volume = volumeOf(plan.model);
  const [level] = levelRange(volume, z / plan.scale, z / plan.scale);
  const inside = volume.inside[level];
  return gridRings(plan.scale, (index) => inside[index] === 1);
}

export function switchArea(plan: ClickerPlan) {
  return gridRings(plan.scale, (index) => plan.slack[index] >= 0);
}

// The biggest outline near the bottom, where a keyring loop can join the housing.
export function bottomOutline(plan: ClickerPlan) {
  return sliceRings(plan, 2.5).reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a), [] as Pt[]);
}
export const SAMPLE_MODEL = "model-sample";

// A chunky puffy star, shown until a model is uploaded.
export function ensureSampleModel() {
  if (models.has(SAMPLE_MODEL)) return;
  const shape = new THREE.Shape();
  for (let index = 0; index <= 10; index += 1) {
    const angle = Math.PI / 2 + (index / 10) * Math.PI * 2;
    const radius = index % 2 ? 30 : 44;
    const point = new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 34, bevelEnabled: true, bevelThickness: 8, bevelSize: 6, bevelSegments: 4 });
  const id = registerModel("Star", Float32Array.from(geometry.getAttribute("position").array));
  models.set(SAMPLE_MODEL, models.get(id)!);
  models.delete(id);
  geometry.dispose();
}
