import { ensureManifold, manifoldKernel, solidPositions, type Solid } from "./manifold";

// How an upload was fixed: welded shut (gaps closed, internal walls and loose bits
// dropped) or rebuilt from its volume at `detail` (its own units per grid step).
export type MeshRepair = { kind: "welded" } | { kind: "rebuilt"; detail: number };

// Grid steps across the longest side when a model is rebuilt from its volume.
const REBUILD_STEPS = 128;
// Below this share of the triangles kept, welding gave up too much of the model.
const KEEP_SHARE = 0.9;

type Welded = { vertices: Float32Array; triangles: Uint32Array };

// Triangle soup to an indexed mesh: corners within `tolerance` become one, and triangles
// that collapse or are listed twice are dropped; a face listed both ways round is an
// internal wall between touching parts, so both go.
function weld(positions: Float32Array, tolerance: number): Welded {
  const keys = new Map<string, number>();
  const vertices: number[] = [];
  const snap = (value: number) => Math.round(value / tolerance);
  const corner = (index: number) => {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    const key = `${snap(x)},${snap(y)},${snap(z)}`;
    let at = keys.get(key);
    if (at === undefined) {
      at = vertices.length / 3;
      keys.set(key, at);
      vertices.push(x, y, z);
    }
    return at;
  };
  const faces = new Map<string, { a: number; b: number; c: number; forward: number; backward: number }>();
  for (let index = 0; index < positions.length / 9; index += 1) {
    const a = corner(index * 3);
    const b = corner(index * 3 + 1);
    const c = corner(index * 3 + 2);
    if (a === b || b === c || a === c) continue;
    const sorted = [a, b, c].sort((left, right) => left - right);
    // Even rotations of the sorted order face one way, odd ones the other.
    const forward = (a === sorted[0] && b === sorted[1]) || (b === sorted[0] && c === sorted[1]) || (c === sorted[0] && a === sorted[1]);
    const key = sorted.join(",");
    const face = faces.get(key);
    if (face) {
      if (forward) face.forward += 1;
      else face.backward += 1;
    } else {
      faces.set(key, { a, b, c, forward: forward ? 1 : 0, backward: forward ? 0 : 1 });
    }
  }
  const triangles: number[] = [];
  for (const face of faces.values()) {
    if (face.forward && face.backward) continue;
    triangles.push(face.a, face.b, face.c);
  }
  return { vertices: new Float32Array(vertices), triangles: new Uint32Array(triangles) };
}

// A solid from an indexed mesh, or null when it isn't closed. Inside-out shells are flipped.
function closedSolid(vertices: Float32Array, triangles: Uint32Array): Solid | null {
  const { Manifold, Mesh } = manifoldKernel();
  const attempt = (triVerts: Uint32Array) => {
    const mesh = new Mesh({ numProp: 3, vertProperties: vertices, triVerts });
    mesh.merge();
    try {
      const solid = new Manifold(mesh);
      if (solid.status() === "NoError" && !solid.isEmpty()) return solid;
      solid.delete();
    } catch {
      // Not closed; the caller tries something else.
    }
    return null;
  };
  const solid = attempt(triangles);
  if (!solid || solid.volume() > 0) return solid;
  solid.delete();
  const flipped = triangles.slice();
  for (let index = 0; index < flipped.length; index += 3) [flipped[index + 1], flipped[index + 2]] = [flipped[index + 2], flipped[index + 1]];
  return attempt(flipped);
}

// Groups of triangles joined edge to edge.
function components(triangles: Uint32Array) {
  const count = triangles.length / 3;
  const parent = Int32Array.from({ length: count }, (_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const edges = new Map<string, number>();
  for (let face = 0; face < count; face += 1) {
    for (let side = 0; side < 3; side += 1) {
      const a = triangles[face * 3 + side];
      const b = triangles[face * 3 + ((side + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const other = edges.get(key);
      if (other === undefined) edges.set(key, face);
      else parent[find(face)] = find(other);
    }
  }
  const groups = new Map<number, number[]>();
  for (let face = 0; face < count; face += 1) {
    const root = find(face);
    const group = groups.get(root);
    if (group) group.push(face);
    else groups.set(root, [face]);
  }
  return [...groups.values()];
}

// Each hole (a loop of edges with a triangle on one side only) capped with a fan around its
// middle; null when the edges don't form clean loops.
function filled(welded: Welded): Welded | null {
  const { vertices, triangles } = welded;
  const edges = new Set<string>();
  for (let index = 0; index < triangles.length; index += 3) {
    for (let side = 0; side < 3; side += 1) edges.add(`${triangles[index + side]},${triangles[index + ((side + 1) % 3)]}`);
  }
  // A hole's edges, turned around: the way its cap's triangles must run.
  const next = new Map<number, number>();
  for (const edge of edges) {
    const [a, b] = edge.split(",").map(Number);
    if (edges.has(`${b},${a}`)) continue;
    if (next.has(b)) return null;
    next.set(b, a);
  }
  if (!next.size) return null;
  const added: number[] = [];
  const caps: number[] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const loop: number[] = [];
    for (let at = start; !done.has(at); at = next.get(at)!) {
      if (!next.has(at)) return null;
      done.add(at);
      loop.push(at);
    }
    if (loop.length < 3) return null;
    const middle = [0, 1, 2].map((axis) => loop.reduce((sum, at) => sum + vertices[at * 3 + axis], 0) / loop.length);
    const center = vertices.length / 3 + added.length / 3;
    added.push(...middle);
    loop.forEach((at, index) => caps.push(at, loop[(index + 1) % loop.length], center));
  }
  const allVertices = new Float32Array(vertices.length + added.length);
  allVertices.set(vertices);
  allVertices.set(added, vertices.length);
  const allTriangles = new Uint32Array(triangles.length + caps.length);
  allTriangles.set(triangles);
  allTriangles.set(caps, triangles.length);
  return { vertices: allVertices, triangles: allTriangles };
}

// A welded mesh as one solid: closed as is, with its holes capped, or as every closed
// piece merged; null when the closed pieces are too little of it.
function weldedSolid(welded: Welded): Solid | null {
  const whole = closedSolid(welded.vertices, welded.triangles);
  if (whole) return whole;
  const capped = filled(welded);
  const sealed = capped && closedSolid(capped.vertices, capped.triangles);
  if (sealed) return sealed;
  const { Manifold } = manifoldKernel();
  const pieces: Solid[] = [];
  let kept = 0;
  for (const group of components(welded.triangles)) {
    if (group.length < 4) continue;
    const triangles = new Uint32Array(group.length * 3);
    group.forEach((face, index) => triangles.set(welded.triangles.subarray(face * 3, face * 3 + 3), index * 3));
    const piece = closedSolid(welded.vertices, triangles);
    if (!piece) continue;
    pieces.push(piece);
    kept += group.length;
  }
  if (!pieces.length || kept < KEEP_SHARE * (welded.triangles.length / 3)) {
    for (const piece of pieces) piece.delete();
    return null;
  }
  if (pieces.length === 1) return pieces[0];
  const merged = Manifold.union(pieces);
  for (const piece of pieces) piece.delete();
  return merged;
}

// Every place lines along axis `c`, through the centers of a grid over axes `a` and `b`,
// cross the surface: per line, the crossings' heights along `c`.
function crossings(positions: Float32Array, axes: [number, number, number], min: number[], step: number, size: number[]) {
  const [a, b, c] = axes;
  const lines = size[a] * size[b];
  const visit = (hit: (line: number, at: number) => void) => {
    for (let t = 0; t < positions.length; t += 9) {
      const pa = [0, 3, 6].map((k) => (positions[t + k + a] - min[a]) / step - 0.5013);
      const pb = [0, 3, 6].map((k) => (positions[t + k + b] - min[b]) / step - 0.4987);
      const x0 = Math.max(0, Math.ceil(Math.min(...pa)));
      const x1 = Math.min(size[a] - 1, Math.floor(Math.max(...pa)));
      const y0 = Math.max(0, Math.ceil(Math.min(...pb)));
      const y1 = Math.min(size[b] - 1, Math.floor(Math.max(...pb)));
      if (x0 > x1 || y0 > y1) continue;
      const area = (pa[1] - pa[0]) * (pb[2] - pb[0]) - (pb[1] - pb[0]) * (pa[2] - pa[0]);
      if (Math.abs(area) < 1e-12) continue;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const w0 = ((pa[1] - x) * (pb[2] - y) - (pb[1] - y) * (pa[2] - x)) / area;
          const w1 = ((pa[2] - x) * (pb[0] - y) - (pb[2] - y) * (pa[0] - x)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          hit(y * size[a] + x, w0 * positions[t + c] + w1 * positions[t + 3 + c] + w2 * positions[t + 6 + c]);
        }
      }
    }
  };
  const offsets = new Uint32Array(lines + 1);
  visit((line) => {
    offsets[line + 1] += 1;
  });
  for (let line = 0; line < lines; line += 1) offsets[line + 1] += offsets[line];
  const heights = new Float32Array(offsets[lines]);
  const cursor = offsets.slice(0, lines);
  visit((line, at) => {
    heights[cursor[line]++] = at;
  });
  return { offsets, heights };
}

// The model rebuilt from which grid cells are inside it. Each cell is judged along all
// three axes by counting surface crossings; lines that cross an odd number of times ran
// through a gap and don't get a say.
function rebuiltSolid(positions: Float32Array, min: number[], max: number[]) {
  const { Manifold } = manifoldKernel();
  const step = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / REBUILD_STEPS;
  const origin = min.map((value) => value - step * 2);
  const size = [0, 1, 2].map((axis) => Math.ceil((max[axis] - min[axis]) / step) + 4);
  const cells = size[0] * size[1] * size[2];
  const cellIndex = (x: number, y: number, z: number) => (z * size[1] + y) * size[0] + x;
  const votes = new Int8Array(cells);
  for (const axes of [[0, 1, 2], [1, 2, 0], [2, 0, 1]] as [number, number, number][]) {
    const [a, b, c] = axes;
    const { offsets, heights } = crossings(positions, axes, origin, step, size);
    const cell = [0, 0, 0];
    for (let line = 0; line < size[a] * size[b]; line += 1) {
      const from = offsets[line];
      const to = offsets[line + 1];
      if ((to - from) % 2) continue;
      const hits = heights.subarray(from, to).sort();
      cell[a] = line % size[a];
      cell[b] = Math.floor(line / size[a]);
      let crossed = 0;
      for (let k = 0; k < size[c]; k += 1) {
        const at = origin[c] + (k + 0.5) * step;
        while (crossed < hits.length && hits[crossed] < at) crossed += 1;
        cell[c] = k;
        votes[cellIndex(cell[0], cell[1], cell[2])] += crossed % 2 ? 1 : -1;
      }
    }
  }
  // Inside is +1 and outside -1, blurred over neighbors so the rebuilt surface is smooth.
  let field = new Float32Array(cells);
  for (let index = 0; index < cells; index += 1) field[index] = votes[index] > 0 ? 1 : -1;
  for (let axis = 0; axis < 3; axis += 1) {
    const stride = axis === 0 ? 1 : axis === 1 ? size[0] : size[0] * size[1];
    const blurred = new Float32Array(cells);
    for (let index = 0; index < cells; index += 1) {
      const along = Math.floor(index / stride) % size[axis];
      const before = along > 0 ? field[index - stride] : -1;
      const after = along < size[axis] - 1 ? field[index + stride] : -1;
      blurred[index] = (before + 2 * field[index] + after) / 4;
    }
    field = blurred;
  }
  const sample = ([px, py, pz]: number[]) => {
    const fx = (px - origin[0]) / step - 0.5;
    const fy = (py - origin[1]) / step - 0.5;
    const fz = (pz - origin[2]) / step - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const z = Math.floor(fz);
    if (x < 0 || y < 0 || z < 0 || x >= size[0] - 1 || y >= size[1] - 1 || z >= size[2] - 1) return -1;
    const tx = fx - x;
    const ty = fy - y;
    const tz = fz - z;
    let value = 0;
    for (let corner = 0; corner < 8; corner += 1) {
      const dx = corner & 1;
      const dy = (corner >> 1) & 1;
      const dz = corner >> 2;
      const weight = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      value += weight * field[cellIndex(x + dx, y + dy, z + dz)];
    }
    return value;
  };
  const rebuilt = Manifold.levelSet(
    (point) => sample(point),
    { min: origin as [number, number, number], max: origin.map((value, axis) => value + size[axis] * step) as [number, number, number] },
    step,
  );
  if (rebuilt.isEmpty()) {
    rebuilt.delete();
    return null;
  }
  return { solid: rebuilt, detail: step };
}

// The upload as a closed solid's triangles, fixed if it wasn't one: welded shut when that
// keeps nearly all of it, otherwise rebuilt from its volume. Null `repair` means it was fine.
export async function repairMesh(positions: Float32Array): Promise<{ positions: Float32Array; repair: MeshRepair | null }> {
  await ensureManifold();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 1) {
    const axis = index % 3;
    min[axis] = Math.min(min[axis], positions[index]);
    max[axis] = Math.max(max[axis], positions[index]);
  }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;

  const close = weld(positions, span * 1e-6);
  const exact = closedSolid(close.vertices, close.triangles);
  if (exact) {
    // Fine as it was unless duplicate or collapsed triangles had to go.
    const untouched = close.triangles.length === positions.length / 3;
    const fixed = untouched ? positions : solidPositions(exact);
    exact.delete();
    return { positions: fixed, repair: untouched ? null : { kind: "welded" } };
  }
  const welded = weldedSolid(weld(positions, span * 2e-5));
  if (welded) {
    const fixed = solidPositions(welded);
    welded.delete();
    return { positions: fixed, repair: { kind: "welded" } };
  }
  const rebuilt = rebuiltSolid(positions, min, max);
  if (!rebuilt) {
    throw new Error("This model is too broken to repair automatically (it may be just loose surfaces). Try exporting it again as a solid.");
  }
  const fixed = solidPositions(rebuilt.solid);
  rebuilt.solid.delete();
  return { positions: fixed, repair: { kind: "rebuilt", detail: rebuilt.detail } };
}
