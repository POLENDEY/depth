import type { TagShape } from "./catalog";

export type TagPoint = { x: number; y: number };

export type TagParts = {
  outer: TagPoint[];
  holes: TagPoint[][];
  focus: TagPoint;
};

type Ellipse = { x: number; y: number; rx: number; ry: number };

function isBasic(shape: TagShape): shape is "circle" | "flower" | "heart" | "star" | "square" {
  return shape === "circle" || shape === "flower" || shape === "heart" || shape === "star" || shape === "square";
}

export function familiarParts(shape: TagShape): TagParts {
  if (isBasic(shape)) throw new Error("Basic tags do not use a familiar silhouette.");
  return BUILD[shape]();
}

const BUILD: Record<Exclude<TagShape, "circle" | "flower" | "heart" | "star" | "square">, () => TagParts> = {
  coffee,
  bread,
  slice,
  butter,
  croissant,
  apple,
  cat,
  dog,
  rabbit,
  elephant,
  bear,
  character,
  cloud,
};

function coffee(): TagParts {
  const outer: TagPoint[] = [];
  outer.push({ x: -36, y: 30 });
  outer.push({ x: -46, y: 34 });
  outer.push({ x: -46, y: 42 });
  outer.push({ x: -18, y: 42 });
  pushArc(outer, 0, 42, 18, 30, Math.PI, 0, 18);
  outer.push({ x: 46, y: 42 });
  outer.push({ x: 46, y: 34 });
  outer.push({ x: 36, y: 30 });
  outer.push({ x: 34, y: 16 });
  // Outer half of the handle. Angles run through the right side, leaving the cup wall as the opening.
  pushArc(outer, 52, 0, 26, 22, 2.336, -2.336, 32);
  outer.push({ x: 34, y: -20 });
  pushArc(outer, 0, -20, 34, 16, -0.2, -Math.PI + 0.2, 18);
  outer.push({ x: -34, y: 24 });
  return { outer, holes: [arcPoints(60, 0, 10, 8.5, 0, Math.PI * 2, 28)], focus: { x: -4, y: 2 } };
}

function bread(): TagParts {
  const baked = unionOutline(
    [
      { x: 0, y: -6, rx: 72, ry: 30 },
      { x: -40, y: 6, rx: 30, ry: 22 },
      { x: 0, y: 12, rx: 32, ry: 24 },
      { x: 40, y: 6, rx: 30, ry: 22 },
    ],
    [],
    { x: 0, y: 0 },
    220,
  );
  const outer = baked.map((point) => (point.y < -18 ? { x: point.x, y: -18 } : point));
  return { outer, holes: [], focus: { x: 0, y: -2 } };
}

function slice(): TagParts {
  const outer: TagPoint[] = [];
  const width = 38;
  pushArc(outer, 0, 0, width, 34, Math.PI * 0.5, Math.PI, 22);
  outer.push({ x: -width, y: -44 });
  pushArc(outer, -width + 12, -44, 12, 12, Math.PI, Math.PI * 1.5, 6);
  outer.push({ x: width - 12, y: -56 });
  pushArc(outer, width - 12, -44, 12, 12, Math.PI * 1.5, Math.PI * 2, 6);
  outer.push({ x: width, y: 0 });
  pushArc(outer, 0, 0, width, 34, 0, Math.PI * 0.5, 22);
  return {
    outer: cutBite(outer, { x: 26, y: 16, r: 15 }, { x: 0, y: -8 }),
    holes: [],
    focus: { x: -2, y: -6 },
  };
}

function butter(): TagParts {
  return {
    outer: skel([
      [-62, -18, 5],
      [64, -18, 4],
      [78, 14, 3],
      [-12, 16, 5],
      [-24, 34, 5],
      [-42, 40, 5],
      [-56, 28, 4],
      [-44, 16, 4],
      [-66, 14, 5],
      [-72, -2, 5],
    ]),
    holes: [],
    focus: { x: 4, y: -2 },
  };
}

function croissant(): TagParts {
  const outer: TagPoint[] = [];
  const steps = 88;
  const start = Math.PI * 0.1;
  const end = Math.PI * 0.9;
  for (let index = 0; index <= steps; index += 1) {
    const u = index / steps;
    const angle = start + (end - start) * u;
    const taper = 0.18 + 0.82 * Math.sin(u * Math.PI);
    const ridge = 1 + 0.14 * Math.abs(Math.sin(u * Math.PI * 5));
    const radius = (20 + 62 * taper) * ridge;
    outer.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.62 });
  }
  for (let index = steps - 1; index >= 1; index -= 1) {
    const u = index / steps;
    const angle = start + (end - start) * u;
    const taper = 0.34 + 0.66 * Math.sin(u * Math.PI);
    const radius = 18 + 28 * taper;
    outer.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.42 });
  }
  const turned = rotate(outer, -0.78);
  return { outer: turned, holes: [], focus: rotate([{ x: 0, y: 34 }], -0.78)[0] };
}

function apple(): TagParts {
  const outer: TagPoint[] = [];
  const radius = 44;
  const cy = -8;
  const top = cy + radius - 1;
  pushArc(outer, 0, cy, radius, radius, Math.PI * 0.62, Math.PI * 2.38, 84);
  outer.push(
    { x: 5, y: top },
    { x: 4, y: top + 14 },
    { x: 18, y: top + 12 },
    { x: 36, y: top + 20 },
    { x: 22, y: top + 30 },
    { x: 6, y: top + 22 },
    { x: -4, y: top + 14 },
    { x: -5, y: top },
  );
  return {
    outer: cutBite(outer, { x: 34, y: 0, r: 16 }, { x: 0, y: cy }),
    holes: [],
    focus: { x: -4, y: cy },
  };
}

function cat(): TagParts {
  return {
    outer: skel([
      [0, -38, 10],
      [26, -32, 8],
      [40, -10, 8],
      [38, 14, 5],
      [30, 26, 2],
      [18, 70, 0],
      [4, 24, 2],
      [0, 16, 4],
      [-4, 24, 2],
      [-18, 70, 0],
      [-30, 26, 2],
      [-38, 14, 5],
      [-40, -10, 8],
      [-26, -32, 8],
    ]),
    holes: [],
    focus: { x: 0, y: -6 },
  };
}

function dog(): TagParts {
  return {
    outer: unionOutline(
      [
        { x: 0, y: 10, rx: 30, ry: 26 },
        { x: 0, y: -26, rx: 16, ry: 18 },
        { x: -36, y: -18, rx: 15, ry: 28 },
        { x: 36, y: -18, rx: 15, ry: 28 },
      ],
      [],
      { x: 0, y: 0 },
      240,
    ),
    holes: [],
    focus: { x: 0, y: -2 },
  };
}

function rabbit(): TagParts {
  return {
    outer: unionOutline(
      [
        { x: 0, y: -18, rx: 32, ry: 30 },
        { x: -18, y: 34, rx: 13, ry: 42 },
        { x: 18, y: 34, rx: 13, ry: 42 },
        { x: 0, y: -40, rx: 16, ry: 12 },
      ],
      [],
      { x: 0, y: -12 },
      260,
    ),
    holes: [],
    focus: { x: 0, y: -16 },
  };
}

function elephant(): TagParts {
  return {
    outer: unionOutline(
      [
        { x: 20, y: 6, rx: 46, ry: 24 },
        { x: -4, y: 16, rx: 16, ry: 14 },
        { x: 8, y: 34, rx: 20, ry: 16 },
        { x: -22, y: 10, rx: 11, ry: 10 },
        { x: -32, y: -8, rx: 10, ry: 12 },
        { x: -34, y: -28, rx: 9, ry: 11 },
        { x: -46, y: -38, rx: 8, ry: 8 },
        { x: 0, y: -22, rx: 10, ry: 16 },
        { x: 18, y: -24, rx: 10, ry: 16 },
        { x: 36, y: -24, rx: 10, ry: 16 },
        { x: 52, y: -18, rx: 11, ry: 15 },
        { x: 68, y: 12, rx: 5, ry: 9 },
      ],
      [],
      { x: 16, y: 4 },
      280,
    ),
    holes: [],
    focus: { x: 18, y: 2 },
  };
}

function bear(): TagParts {
  return {
    outer: unionOutline(
      [
        { x: 0, y: 2, rx: 42, ry: 36 },
        { x: -34, y: 30, rx: 14, ry: 13 },
        { x: 34, y: 30, rx: 14, ry: 13 },
        { x: 0, y: -30, rx: 22, ry: 16 },
        { x: 0, y: -46, rx: 9, ry: 8 },
      ],
      [],
      { x: 0, y: -4 },
      240,
    ),
    holes: [],
    focus: { x: 0, y: -6 },
  };
}

function character(): TagParts {
  const rows: Array<[number, number, number]> = [
    [-26, -70, 5],
    [-8, -70, 3],
    [-7, -38, 4],
    [7, -38, 4],
    [8, -70, 3],
    [26, -70, 5],
    [30, -32, 6],
    [20, -14, 5],
    [42, -18, 5],
    [58, -8, 6],
    [62, 6, 6],
    [48, 14, 5],
    [26, 4, 5],
    [16, 18, 4],
  ];
  let bow = false;
  const right = -0.55;
  const left = Math.PI + 0.55;
  for (let index = 0; index <= 36; index += 1) {
    const angle = right + ((left - right) * index) / 36;
    if (!bow && angle >= 1.15) {
      bow = true;
      rows.push([5, 50, 4], [0, 62, 4], [-6, 50, 4]);
    }
    if (angle > 1.15 && angle < 2.0) continue;
    rows.push([Math.cos(angle) * 24, 32 + Math.sin(angle) * 22, 0]);
  }
  rows.push(
    [-16, 18, 4],
    [-26, 4, 5],
    [-48, 14, 5],
    [-62, 6, 6],
    [-58, -8, 6],
    [-42, -18, 5],
    [-20, -14, 5],
    [-30, -32, 6],
  );
  return { outer: skel(rows), holes: [], focus: { x: 0, y: 28 } };
}

function cloud(): TagParts {
  return {
    outer: unionOutline(
      [
        { x: -48, y: -2, rx: 30, ry: 22 },
        { x: -16, y: 18, rx: 34, ry: 26 },
        { x: 24, y: 20, rx: 32, ry: 24 },
        { x: 56, y: 2, rx: 26, ry: 20 },
        { x: 24, y: -12, rx: 32, ry: 18 },
        { x: -16, y: -14, rx: 30, ry: 16 },
      ],
      [],
      { x: 0, y: 0 },
      240,
    ),
    holes: [],
    focus: { x: 0, y: 0 },
  };
}

function unionOutline(ellipses: Ellipse[], polygons: TagPoint[][], origin: TagPoint, steps: number) {
  const outer: TagPoint[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let farthest = 0;
    for (const ellipse of ellipses) farthest = Math.max(farthest, farEllipse(origin, dx, dy, ellipse));
    for (const polygon of polygons) farthest = Math.max(farthest, farPolygon(origin, dx, dy, polygon));
    outer.push({ x: origin.x + dx * farthest, y: origin.y + dy * farthest });
  }
  return outer;
}

function farEllipse(origin: TagPoint, dx: number, dy: number, ellipse: Ellipse) {
  const fx = (origin.x - ellipse.x) / ellipse.rx;
  const fy = (origin.y - ellipse.y) / ellipse.ry;
  const gx = dx / ellipse.rx;
  const gy = dy / ellipse.ry;
  const a = gx * gx + gy * gy;
  const b = 2 * (fx * gx + fy * gy);
  const c = fx * fx + fy * fy - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-8) return 0;
  return Math.max((-b + Math.sqrt(disc)) / (2 * a), 0);
}

function farPolygon(origin: TagPoint, dx: number, dy: number, polygon: TagPoint[]) {
  let farthest = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const ex = end.x - start.x;
    const ey = end.y - start.y;
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-8) continue;
    const t = ((start.x - origin.x) * ey - (start.y - origin.y) * ex) / det;
    const u = ((start.x - origin.x) * dy - (start.y - origin.y) * dx) / det;
    if (t > farthest && u >= 0 && u <= 1) farthest = t;
  }
  return farthest;
}

function cutBite(loop: TagPoint[], bite: { x: number; y: number; r: number }, centroid: TagPoint) {
  const inside = (point: TagPoint) => Math.hypot(point.x - bite.x, point.y - bite.y) < bite.r - 0.2;
  const rotated = loop.slice();
  let guard = 0;
  while (inside(rotated[0]) && guard < rotated.length) {
    rotated.push(rotated.shift() as TagPoint);
    guard += 1;
  }
  const start = rotated.findIndex(inside);
  if (start < 0) return loop;
  let end = start;
  while (end < rotated.length && inside(rotated[end])) end += 1;
  const before = rotated[start - 1];
  const after = rotated[end % rotated.length];
  const a0 = Math.atan2(before.y - bite.y, before.x - bite.x);
  const a1 = Math.atan2(after.y - bite.y, after.x - bite.x);
  return [...rotated.slice(0, start), ...arcBetween(bite, a0, a1, centroid), ...rotated.slice(end)];
}

function arcBetween(bite: { x: number; y: number; r: number }, a0: number, a1: number, centroid: TagPoint) {
  const sweep = (delta: number) => {
    let value = delta;
    while (value <= -Math.PI) value += Math.PI * 2;
    while (value > Math.PI) value -= Math.PI * 2;
    return value;
  };
  const short = sweep(a1 - a0);
  const options = [short, short > 0 ? short - Math.PI * 2 : short + Math.PI * 2];
  let delta = options[0];
  let nearest = Infinity;
  for (const option of options) {
    const mid = a0 + option / 2;
    const point = { x: bite.x + Math.cos(mid) * bite.r, y: bite.y + Math.sin(mid) * bite.r };
    const distance = Math.hypot(point.x - centroid.x, point.y - centroid.y);
    if (distance < nearest) {
      nearest = distance;
      delta = option;
    }
  }
  const points: TagPoint[] = [];
  for (let index = 1; index < 18; index += 1) {
    const angle = a0 + (delta * index) / 18;
    points.push({ x: bite.x + Math.cos(angle) * bite.r, y: bite.y + Math.sin(angle) * bite.r });
  }
  return points;
}

function skel(rows: Array<[number, number, number]>) {
  return fillet(
    rows.map(([x, y]) => ({ x, y })),
    rows.map((row) => row[2]),
  );
}

function fillet(points: TagPoint[], radii: number[]) {
  const count = points.length;
  const outer: TagPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const radius = radii[index] ?? 0;
    const current = points[index];
    if (!(radius > 0)) {
      outer.push(current);
      continue;
    }
    const previous = points[(index - 1 + count) % count];
    const next = points[(index + 1) % count];
    const d1 = Math.hypot(current.x - previous.x, current.y - previous.y);
    const d2 = Math.hypot(next.x - current.x, next.y - current.y);
    if (d1 < 0.01 || d2 < 0.01) {
      outer.push(current);
      continue;
    }
    const cut = Math.min(radius, d1 * 0.46, d2 * 0.46);
    const lead = {
      x: current.x + ((previous.x - current.x) / d1) * cut,
      y: current.y + ((previous.y - current.y) / d1) * cut,
    };
    const leave = {
      x: current.x + ((next.x - current.x) / d2) * cut,
      y: current.y + ((next.y - current.y) / d2) * cut,
    };
    for (let step = 0; step <= 5; step += 1) {
      const t = step / 5;
      const u = 1 - t;
      outer.push({
        x: u * u * lead.x + 2 * u * t * current.x + t * t * leave.x,
        y: u * u * lead.y + 2 * u * t * current.y + t * t * leave.y,
      });
    }
  }
  return dedupe(outer);
}

function pushArc(
  out: TagPoint[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  steps: number,
) {
  out.push(...arcPoints(cx, cy, rx, ry, a0, a1, steps));
}

function arcPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  steps: number,
) {
  const points: TagPoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = a0 + ((a1 - a0) * index) / steps;
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
  }
  return points;
}

function rotate(points: TagPoint[], angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((point) => ({
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }));
}

function dedupe(points: TagPoint[]) {
  const next: TagPoint[] = [];
  for (const point of points) {
    const last = next[next.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.15) continue;
    next.push(point);
  }
  if (next.length > 2 && Math.hypot(next[0].x - next[next.length - 1].x, next[0].y - next[next.length - 1].y) < 0.15) {
    next.pop();
  }
  return next;
}
