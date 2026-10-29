// Bambu-style smart fill on a triangle soup: neighboring triangles join a region while the
// angle between them stays under a limit, so regions stop at sharp edges. Also finds a flat cut
// that takes a region off as the cap.

export type CutSuggestion = {
  tilt: number;
  turn: number;
  normal: [number, number, number];
  // The plane is every point p with p · normal = offset.
  offset: number;
  // A point well inside the region's side of the cut, in the same units as the positions.
  at: [number, number, number];
};

const WELD = 1e-3;

export class SurfaceMap {
  readonly faceCount: number;
  readonly normals: Float32Array;
  readonly areas: Float32Array;
  readonly totalArea: number;
  // Each edge's two welded ends and the faces on it (-1 for an open edge). Edges with more
  // than two faces keep the first two.
  private readonly edgeA: Int32Array;
  private readonly edgeB: Int32Array;
  private readonly edgeF1: Int32Array;
  private readonly edgeF2: Int32Array;
  private readonly edgeCount: number;
  private readonly welded: Float32Array;
  private labelCache = new Map<number, Int32Array>();

  constructor(readonly positions: ArrayLike<number>) {
    const faceCount = Math.floor(positions.length / 9);
    this.faceCount = faceCount;
    const ids = new Int32Array(faceCount * 3);
    const lookup = new Map<string, number>();
    const welded: number[] = [];
    for (let corner = 0; corner < faceCount * 3; corner += 1) {
      const x = positions[corner * 3];
      const y = positions[corner * 3 + 1];
      const z = positions[corner * 3 + 2];
      const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
      let id = lookup.get(key);
      if (id === undefined) {
        id = welded.length / 3;
        lookup.set(key, id);
        welded.push(x, y, z);
      }
      ids[corner] = id;
    }
    this.welded = Float32Array.from(welded);

    this.normals = new Float32Array(faceCount * 3);
    this.areas = new Float32Array(faceCount);
    let total = 0;
    for (let face = 0; face < faceCount; face += 1) {
      const o = face * 9;
      const ux = positions[o + 3] - positions[o];
      const uy = positions[o + 4] - positions[o + 1];
      const uz = positions[o + 5] - positions[o + 2];
      const vx = positions[o + 6] - positions[o];
      const vy = positions[o + 7] - positions[o + 1];
      const vz = positions[o + 8] - positions[o + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      this.areas[face] = length / 2;
      total += length / 2;
      if (length > 0) {
        this.normals[face * 3] = nx / length;
        this.normals[face * 3 + 1] = ny / length;
        this.normals[face * 3 + 2] = nz / length;
      }
    }
    this.totalArea = total;

    const vertexCount = welded.length / 3;
    const edgeOf = new Map<number, number>();
    const a: number[] = [];
    const b: number[] = [];
    const f1: number[] = [];
    const f2: number[] = [];
    for (let face = 0; face < faceCount; face += 1) {
      for (let side = 0; side < 3; side += 1) {
        const p = ids[face * 3 + side];
        const q = ids[face * 3 + ((side + 1) % 3)];
        if (p === q) continue;
        const low = Math.min(p, q);
        const high = Math.max(p, q);
        const key = low * vertexCount + high;
        const edge = edgeOf.get(key);
        if (edge === undefined) {
          edgeOf.set(key, a.length);
          a.push(low);
          b.push(high);
          f1.push(face);
          f2.push(-1);
        } else if (f2[edge] === -1 && f1[edge] !== face) {
          f2[edge] = face;
        }
      }
    }
    this.edgeA = Int32Array.from(a);
    this.edgeB = Int32Array.from(b);
    this.edgeF1 = Int32Array.from(f1);
    this.edgeF2 = Int32Array.from(f2);
    this.edgeCount = a.length;
  }

  // Which region each face is in, for neighbors joining while they turn at most `angle` degrees.
  labels(angle: number) {
    const key = Math.round(angle * 10);
    const cached = this.labelCache.get(key);
    if (cached) return cached;
    const parent = new Int32Array(this.faceCount);
    for (let face = 0; face < this.faceCount; face += 1) parent[face] = face;
    const root = (face: number) => {
      while (parent[face] !== face) {
        parent[face] = parent[parent[face]];
        face = parent[face];
      }
      return face;
    };
    const limit = Math.cos((Math.min(180, Math.max(0, angle)) * Math.PI) / 180) - 1e-6;
    const n = this.normals;
    for (let edge = 0; edge < this.edgeCount; edge += 1) {
      const p = this.edgeF1[edge];
      const q = this.edgeF2[edge];
      if (q < 0) continue;
      const dot = n[p * 3] * n[q * 3] + n[p * 3 + 1] * n[q * 3 + 1] + n[p * 3 + 2] * n[q * 3 + 2];
      if (dot < limit) continue;
      const rp = root(p);
      const rq = root(q);
      if (rp !== rq) parent[rp] = rq;
    }
    const labels = new Int32Array(this.faceCount);
    for (let face = 0; face < this.faceCount; face += 1) labels[face] = root(face);
    this.labelCache.set(key, labels);
    return labels;
  }

  // The region's border as line segments (x, y, z, x, y, z, ...).
  outline(labels: Int32Array, label: number) {
    const segments: number[] = [];
    const w = this.welded;
    for (let edge = 0; edge < this.edgeCount; edge += 1) {
      const p = this.edgeF1[edge];
      const q = this.edgeF2[edge];
      const inP = labels[p] === label;
      const inQ = q >= 0 && labels[q] === label;
      if (inP === inQ) continue;
      const s = this.edgeA[edge] * 3;
      const t = this.edgeB[edge] * 3;
      segments.push(w[s], w[s + 1], w[s + 2], w[t], w[t + 1], w[t + 2]);
    }
    return segments;
  }

  // The region's triangles, as positions.
  triangles(labels: Int32Array, label: number) {
    let count = 0;
    for (let face = 0; face < this.faceCount; face += 1) if (labels[face] === label) count += 1;
    const out = new Float32Array(count * 9);
    let at = 0;
    for (let face = 0; face < this.faceCount; face += 1) {
      if (labels[face] !== label) continue;
      for (let index = 0; index < 9; index += 1) out[at++] = this.positions[face * 9 + index];
    }
    return out;
  }

  regionArea(labels: Int32Array, label: number) {
    let area = 0;
    for (let face = 0; face < this.faceCount; face += 1) if (labels[face] === label) area += this.areas[face];
    return area;
  }

  // A flat cut with the whole region on its far side and as little else as it can, leaning
  // toward the way the region faces. Null when the region is most of the model.
  suggestCut(labels: Int32Array, label: number, margin = 0.4): CutSuggestion | null {
    const regionPoints: number[] = [];
    const otherPoints: number[] = [];
    const otherAreas: number[] = [];
    const mean = [0, 0, 0];
    let regionArea = 0;
    const p = this.positions;
    for (let face = 0; face < this.faceCount; face += 1) {
      const o = face * 9;
      if (labels[face] === label) {
        for (let index = 0; index < 9; index += 1) regionPoints.push(p[o + index]);
        const area = this.areas[face];
        regionArea += area;
        mean[0] += this.normals[face * 3] * area;
        mean[1] += this.normals[face * 3 + 1] * area;
        mean[2] += this.normals[face * 3 + 2] * area;
      } else {
        otherPoints.push((p[o] + p[o + 3] + p[o + 6]) / 3, (p[o + 1] + p[o + 4] + p[o + 7]) / 3, (p[o + 2] + p[o + 5] + p[o + 8]) / 3);
        otherAreas.push(this.areas[face]);
      }
    }
    const total = this.totalArea;
    if (!regionPoints.length || regionArea > total * 0.85) return null;
    const meanLength = Math.hypot(mean[0], mean[1], mean[2]);
    const facing = meanLength > regionArea * 0.2 ? mean.map((value) => value / meanLength) : null;

    // Subsample big meshes; the region's lowest point uses every vertex.
    const otherStride = Math.max(1, Math.floor(otherAreas.length / 8000));
    const direction = (tilt: number, turn: number): [number, number, number] => {
      const t = (tilt * Math.PI) / 180;
      const r = (turn * Math.PI) / 180;
      return [Math.sin(t) * Math.cos(r), Math.sin(t) * Math.sin(r), Math.cos(t)];
    };
    const regionStride = Math.max(1, Math.floor(regionPoints.length / 3 / 6000)) * 3;
    const score = (tilt: number, turn: number, exact = false) => {
      const n = direction(tilt, turn);
      let low = Infinity;
      for (let index = 0; index < regionPoints.length; index += exact ? 3 : regionStride) {
        const along = regionPoints[index] * n[0] + regionPoints[index + 1] * n[1] + regionPoints[index + 2] * n[2];
        if (along < low) low = along;
      }
      const offset = low - margin;
      let above = 0;
      let below = 0;
      for (let index = 0; index < otherAreas.length; index += otherStride) {
        const o = index * 3;
        const along = otherPoints[o] * n[0] + otherPoints[o + 1] * n[1] + otherPoints[o + 2] * n[2];
        if (along > offset) above += otherAreas[index];
        else below += otherAreas[index];
      }
      above *= otherStride;
      below *= otherStride;
      // The housing needs something to hold the switch.
      if (below < total * 0.15) return { value: Infinity, offset, n };
      const lean = facing ? 1 - (n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2]) : 0;
      return { value: above / total + 0.04 * lean + 0.0005 * Math.min(tilt, 180 - tilt) / 90, offset, n };
    };

    let best = { tilt: 0, turn: 0, value: Infinity };
    const consider = (tilt: number, turn: number) => {
      tilt = Math.min(180, Math.max(0, Math.round(tilt)));
      turn = tilt === 0 || tilt === 180 ? 0 : ((Math.round(turn) % 360) + 360) % 360;
      const { value } = score(tilt, turn);
      if (value < best.value) best = { tilt, turn, value };
    };
    for (let tilt = 0; tilt <= 180; tilt += 15) {
      for (let turn = 0; turn < 360; turn += tilt === 0 || tilt === 180 ? 360 : 15) consider(tilt, turn);
    }
    if (facing) {
      const tilt = (Math.acos(Math.min(1, Math.max(-1, facing[2]))) * 180) / Math.PI;
      consider(tilt, (Math.atan2(facing[1], facing[0]) * 180) / Math.PI);
    }
    if (!Number.isFinite(best.value)) return null;
    for (const step of [5, 1]) {
      const { tilt, turn } = best;
      for (let dt = -3; dt <= 3; dt += 1) for (let dp = -3; dp <= 3; dp += 1) consider(tilt + dt * step, turn + dp * step);
    }

    const { offset, n } = score(best.tilt, best.turn, true);
    let deepest = 0;
    let deepestAlong = -Infinity;
    for (let index = 0; index < regionPoints.length; index += 3) {
      const along = regionPoints[index] * n[0] + regionPoints[index + 1] * n[1] + regionPoints[index + 2] * n[2];
      if (along > deepestAlong) {
        deepestAlong = along;
        deepest = index;
      }
    }
    return {
      tilt: best.tilt,
      turn: best.turn,
      normal: n,
      offset,
      at: [regionPoints[deepest], regionPoints[deepest + 1], regionPoints[deepest + 2]],
    };
  }
}
