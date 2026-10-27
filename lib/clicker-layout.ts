import ClipperLib from "clipper-lib";
import type { Path, Paths } from "clipper-lib";
import type { PartCaps, ProductSettings } from "./catalog";
import { charmLayers } from "./charms";
import { imageParts, type ImagePart } from "./image-parts";

export type Pt = { x: number; y: number };
export type HousingShape = "rect" | "pill" | "circle" | "heart" | "cloud" | "hexagon" | "custom";
export type CapShape = "match" | "square";

export const HOUSING_SHAPES: { value: HousingShape; label: string }[] = [
  { value: "rect", label: "Rectangle" },
  { value: "pill", label: "Pill" },
  { value: "circle", label: "Circle" },
  { value: "heart", label: "Heart" },
  { value: "cloud", label: "Cloud" },
  { value: "hexagon", label: "Hexagon" },
  { value: "custom", label: "Your SVG or PNG" },
];

// A keycap has to cover the switch: its 16.4 mm skirt hollow plus a 1 mm wall.
export const KEY = { cap: 18.4, capRadius: 2.4, clearance: 0.5, wall: 2.05, switchHalf: 9.2 };

const SCALE = 1000;

function toPath(ring: Pt[]): Path {
  return ring.map((point) => ({ X: Math.round(point.x * SCALE), Y: Math.round(point.y * SCALE) }));
}

function fromPath(path: Path): Pt[] {
  return path.map((point) => ({ x: point.X / SCALE, y: point.Y / SCALE }));
}

function signedArea(ring: Pt[]) {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function pathsArea(paths: Paths) {
  return paths.reduce((sum, path) => sum + signedArea(fromPath(path)), 0);
}

function run(type: number, subject: Paths, clip: Paths = []) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return ClipperLib.Clipper.PolyTreeToPaths(tree);
}

function offset(paths: Paths, delta: number, open = false) {
  const clipper = new ClipperLib.ClipperOffset(2, 0.02 * SCALE);
  clipper.AddPaths(paths, ClipperLib.JoinType.jtRound, open ? ClipperLib.EndType.etOpenRound : ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  clipper.Execute(solution, delta * SCALE);
  return solution;
}

// The biggest outer ring, counterclockwise. Holes and small islands are dropped.
function largest(paths: Paths): Pt[] {
  let best: Pt[] = [];
  let bestArea = 0;
  for (const path of paths) {
    const ring = fromPath(path);
    const area = Math.abs(signedArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return signedArea(best) < 0 ? best.reverse() : best;
}

// Rounds every convex and concave corner to at least `radius`.
function smoothRing(ring: Pt[], radius: number) {
  const closed = offset(offset([toPath(ring)], radius), -radius);
  return largest(offset(offset(closed, -radius), radius));
}

export function bounds(ring: Pt[]) {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function moved(ring: Pt[], dx: number, dy: number, scale = 1) {
  return ring.map((point) => ({ x: point.x * scale + dx, y: point.y * scale + dy }));
}

// Centered on its bounding box with the longer side 1 long.
function normalize(ring: Pt[]) {
  const box = bounds(ring);
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY) || 1;
  return moved(ring, -(box.minX + box.maxX) / (2 * size), -(box.minY + box.maxY) / (2 * size), 1 / size);
}

export function roundedRectRing(cx: number, cy: number, width: number, height: number, radius: number, steps = 8) {
  const r = Math.min(radius, width / 2, height / 2);
  const hw = width / 2 - r;
  const hh = height / 2 - r;
  const ring: Pt[] = [];
  [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]].forEach(([x, y], index) => {
    for (let step = 0; step <= steps; step += 1) {
      const angle = ((index - 1) + step / steps) * (Math.PI / 2);
      ring.push({ x: cx + x + Math.cos(angle) * r, y: cy + y + Math.sin(angle) * r });
    }
  });
  return ring;
}

function circleRing(cx: number, cy: number, radius: number, count = 96) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

const outlines = new Map<string, Pt[] | null>();

// The housing outline at unit size (longer side 1), or null for shapes fitted around the keys.
export function baseOutline(shape: HousingShape, logoId: string): Pt[] | null {
  if (shape === "rect" || shape === "pill") return null;
  const key = `${shape}:${shape === "custom" ? logoId : ""}`;
  if (outlines.has(key)) return outlines.get(key)!;
  let ring: Pt[] | null = null;
  if (shape === "circle") ring = circleRing(0, 0, 0.5);
  if (shape === "heart") {
    ring = Array.from({ length: 160 }, (_, index) => {
      const t = (index / 160) * Math.PI * 2;
      return {
        x: 16 * Math.sin(t) ** 3,
        y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
      };
    });
    if (signedArea(ring) < 0) ring.reverse();
  }
  if (shape === "cloud") {
    const puffs = [
      [-0.27, -0.06, 0.2],
      [-0.08, 0.12, 0.25],
      [0.18, 0.08, 0.22],
      [0.3, -0.08, 0.18],
      [0.01, -0.08, 0.27],
    ];
    ring = largest(run(ClipperLib.ClipType.ctUnion, puffs.map(([x, y, r]) => toPath(circleRing(x, y, r, 64)))));
  }
  if (shape === "hexagon") {
    ring = Array.from({ length: 6 }, (_, index) => {
      const angle = (index / 6) * Math.PI * 2;
      return { x: Math.cos(angle) * 0.5, y: Math.sin(angle) * 0.5 };
    });
  }
  if (shape === "custom" && logoId) {
    const layers = charmLayers(logoId, 0, 0, 1);
    const rings = layers ? (layers.body.length ? layers.body : layers.mark) : [];
    const paths = rings.map((entry) => toPath(entry.points.map((point) => ({ x: point.x * 100, y: point.y * 100 }))));
    const filled = paths.length ? largest(run(ClipperLib.ClipType.ctUnion, paths)) : [];
    if (filled.length >= 3) ring = filled;
  }
  const result = ring ? smoothRing(normalize(ring).map((point) => ({ x: point.x * 100, y: point.y * 100 })), 2.5) : null;
  const unit = result ? normalize(result) : null;
  outlines.set(key, unit);
  return unit;
}

// `tolerance` is the area allowed to poke out, in the outline's own units squared.
function contains(outline: Paths, part: Paths, tolerance: number) {
  return pathsArea(run(ClipperLib.ClipType.ctDifference, part, outline)) < tolerance;
}

const caps = new Map<string, Pt[]>();

// Keycap outline around its switch at (0, 0): the housing shape shrunk until the switch
// square just fits inside it, or the standard rounded square.
export function capOutline(shape: HousingShape, capShape: CapShape, logoId: string): Pt[] {
  const square = roundedRectRing(0, 0, KEY.cap, KEY.cap, KEY.capRadius);
  if (capShape === "square" || shape === "rect") return square;
  const base = shape === "pill" ? normalize(circleRing(0, 0, 0.5)) : baseOutline(shape, logoId);
  if (!base) return square;
  const key = `${shape}:${shape === "custom" ? logoId : ""}`;
  if (caps.has(key)) return caps.get(key)!;
  // Searched at 100x so clipper's integer grid stays fine next to the unit-sized outline.
  const outline = [toPath(moved(base, 0, 0, 100))];
  // The standard cap footprint, rounded corners included, at any size.
  const corner = KEY.capRadius / KEY.cap;
  const fits = (cx: number, cy: number, half: number) =>
    contains(outline, [toPath(roundedRectRing(cx * 100, cy * 100, half * 200, half * 200, half * 200 * corner, 4))], 1e-3);
  const biggest = (cx: number, cy: number) => {
    let low = 0;
    let high = 0.5;
    if (!fits(cx, cy, 0.001)) return 0;
    for (let step = 0; step < 14; step += 1) {
      const mid = (low + high) / 2;
      if (fits(cx, cy, mid)) low = mid;
      else high = mid;
    }
    return low;
  };
  let best = { x: 0, y: 0, half: biggest(0, 0) };
  for (const [span, steps] of [[0.4, 8], [0.06, 4]] as const) {
    const center = best;
    for (let i = -steps; i <= steps; i += 1) {
      for (let j = -steps; j <= steps; j += 1) {
        const x = center.x + (i / steps) * span;
        const y = center.y + (j / steps) * span;
        const half = biggest(x, y);
        if (half > best.half) best = { x, y, half };
      }
    }
  }
  const scale = (KEY.switchHalf + 0.05) / Math.max(0.01, best.half);
  // Corners at least as round as a standard cap, so the 1.5 mm top bevel stays clean.
  const cap = smoothRing(moved(base, -best.x * scale, -best.y * scale, scale), KEY.capRadius);
  caps.set(key, cap);
  return cap;
}

export type ClickerLayout = {
  outline: Pt[];
  cap: Pt[];
  pocket: Pt[];
  positions: Pt[];
  error: string | null;
};

export type LayoutInput = {
  keys: number;
  shape: HousingShape;
  capShape: CapShape;
  logoId: string;
  size: number;
  positions: Pt[];
};

// Letters first, then emojis and logos, eight keys at most.
export function clickerKeyCount(settings: ProductSettings) {
  if (partsMode(settings)) return settings.partCaps === "parts" ? settings.housingParts.length : 1;
  const chars = Array.from(settings.text.normalize("NFC")).filter((char) => char.trim()).length;
  return Math.min(8, chars + settings.charms.length);
}

export function clickerLayoutInput(settings: ProductSettings, keys = clickerKeyCount(settings)): LayoutInput {
  return {
    keys,
    shape: settings.housingShape,
    capShape: settings.capShape,
    logoId: settings.housingLogo,
    size: settings.housingSize,
    positions: settings.keyLayout,
  };
}

const layouts = new Map<string, ClickerLayout>();

// Where each switch sits and the housing outline around them, all in mm.
export function clickerLayout(input: LayoutInput): ClickerLayout {
  const key = JSON.stringify(input);
  const cached = layouts.get(key);
  if (cached) return cached;
  const layout = computeLayout(input);
  if (layouts.size > 40) layouts.delete(layouts.keys().next().value!);
  layouts.set(key, layout);
  return layout;
}

function computeLayout(input: LayoutInput): ClickerLayout {
  const shape = input.shape === "custom" && !baseOutline("custom", input.logoId) ? "rect" : input.shape;
  const cap = capOutline(shape, input.capShape, input.logoId);
  const pocket = largest(offset([toPath(cap)], KEY.clearance));
  const pocketBox = bounds(pocket);
  const pitch = pocketBox.maxX - pocketBox.minX + KEY.wall;
  const rise = pocketBox.maxY - pocketBox.minY + KEY.wall;
  const row = (y: number) =>
    Array.from({ length: input.keys }, (_, index) => ({ x: (index - (input.keys - 1) / 2) * pitch, y }));
  // `rows` centered rows, the upper ones taking any extra key, shifted up by `y`.
  const grid = (rows: number, y: number) => {
    const positions: Pt[] = [];
    let left = input.keys;
    for (let line = 0; line < rows; line += 1) {
      const count = Math.ceil(left / (rows - line));
      left -= count;
      for (let index = 0; index < count; index += 1) {
        positions.push({ x: (index - (count - 1) / 2) * pitch, y: y + ((rows - 1) / 2 - line) * rise });
      }
    }
    return positions;
  };
  const custom = input.positions.length === input.keys;
  const grown = offset([toPath(pocket)], KEY.wall - 0.01);
  const placed = (positions: Pt[], paths: Paths) =>
    positions.flatMap((position) => paths.map((path) => toPath(moved(fromPath(path), position.x, position.y))));

  let positions = custom ? input.positions : row(0);
  let outline: Pt[];
  const base = baseOutline(shape, input.logoId);
  if (!base) {
    const all = bounds(placed(positions, [toPath(pocket)]).flatMap(fromPath));
    if (shape === "pill") {
      const y = positions.reduce((sum, position) => sum + position.y, 0) / positions.length;
      const xs = positions.map((position) => position.x);
      const spine = [{ x: Math.min(...xs), y }, { x: Math.max(...xs), y }];
      let radius = 0;
      for (const point of placed(positions, [toPath(pocket)]).flatMap(fromPath)) {
        const along = Math.max(spine[0].x, Math.min(spine[1].x, point.x));
        radius = Math.max(radius, Math.hypot(point.x - along, point.y - y));
      }
      const tube = offset([toPath(spine[1].x - spine[0].x < 0.01 ? [spine[0], { x: spine[0].x + 0.01, y }] : spine)], radius + KEY.wall, true);
      outline = largest(tube);
    } else {
      outline = roundedRectRing(
        (all.minX + all.maxX) / 2,
        (all.minY + all.maxY) / 2,
        all.maxX - all.minX + KEY.wall * 2,
        all.maxY - all.minY + KEY.wall * 2,
        3,
      );
    }
  } else {
    let shift = { x: 0, y: 0 };
    const fits = (scale: number, positions: Pt[], at = shift) =>
      contains([toPath(moved(base, at.x * scale, at.y * scale, scale))], placed(positions, grown), 0.01);
    const fit = (place: (scale: number) => Pt[], limit: number, at = shift) => {
      let low = 1;
      let high = limit;
      if (!fits(high, place(high), at)) return Infinity;
      for (let step = 0; step < 20; step += 1) {
        const mid = (low + high) / 2;
        if (fits(mid, place(mid), at)) high = mid;
        else low = mid;
      }
      return high;
    };
    let scale: number;
    if (custom) {
      // Hand-placed keys stay put; the outline slides around them to stay as small as it can.
      const box = bounds(positions);
      const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      const around = () => positions.map((position) => ({ x: position.x - center.x, y: position.y - center.y }));
      let best = { scale: 1000, at: shift };
      for (let u = -0.2; u <= 0.201; u += 0.1) {
        for (let v = -0.2; v <= 0.201; v += 0.1) {
          const candidate = fit(around, best.scale, { x: u, y: v });
          if (candidate < best.scale - 0.01) best = { scale: candidate, at: { x: u, y: v } };
        }
      }
      scale = best.scale < 1000 ? best.scale : Infinity;
      const final = Math.max(scale, input.size);
      shift = { x: best.at.x + center.x / final, y: best.at.y + center.y / final };
    } else {
      let best = { scale: 1000, rows: 1, v: 0 };
      for (let rows = 1; rows <= Math.min(3, input.keys); rows += 1) {
        for (let v = -0.3; v <= 0.301; v += 0.1) {
          const candidate = fit((size) => grid(rows, v * size), best.scale);
          if (candidate < best.scale - 0.01) best = { scale: candidate, rows, v };
        }
      }
      scale = Math.max(best.scale, input.size);
      positions = grid(best.rows, best.v * scale);
    }
    if (!Number.isFinite(scale)) return { outline: [], cap, pocket, positions, error: "Those keys are too far apart. Press Auto arrange." };
    scale = Math.max(scale, input.size);
    outline = moved(base, shift.x * scale, shift.y * scale, scale);
  }

  let error: string | null = null;
  const halfWall = offset([toPath(pocket)], KEY.wall / 2 - 0.01);
  const each = positions.map((position) => placed([position], halfWall));
  const separate = each.reduce((sum, paths) => sum + pathsArea(paths), 0);
  if (positions.length > 1 && pathsArea(run(ClipperLib.ClipType.ctUnion, each.flat())) < separate - 0.05) {
    error = "Two keys are too close together. Drag them apart or press Auto arrange.";
  }
  return { outline, cap, pocket, positions, error };
}

// Clickers made from parts of an imported image. The switch can't fit through a small
// part, so the housing is a base with square switch sockets plus a lid with the part
// holes, glued on once the switches are in. Each cap is its part as a flat slab on a stem.
export const PART = {
  chamber: 16.4,
  wall: 1.6,
  post: 2.75,
  postWall: 0.8,
  gap: 0.4,
  slab: 3,
  lid: 2,
  inlay: 0.6,
  // Rim around the base the lid drops into, and the lid's play inside it.
  border: 2.4,
  lidFit: 0.2,
  // Plain band in the housing color around each cap's picture.
  capBorder: 1.2,
  // Lid features thinner than this are dropped; they'd be loose slivers.
  minFeature: 1.2,
  // Smallest color detail kept (mm²), about one nozzle-width square.
  minDetail: 0.15,
  maxSize: 600,
};

export type Polygon = Pt[][];

// `inlays` are the picture's colors on the cap's top face, and `border` the plain band around them.
export type PartKey = {
  cap: Polygon;
  parts: number[];
  inlays: { color: string; polygons: Polygon[] }[];
  border: Polygon[];
};

export type PartsLayout = {
  outline: Pt[];
  // Inside of the base's rim: the lid and caps sit in here.
  recess: Pt[];
  pocket: Pt[];
  positions: Pt[];
  keys: PartKey[];
  lid: Polygon[];
  inlays: { color: string; polygons: Polygon[] }[];
  // Millimeters per image unit (the image's longer side is 0.98 units).
  scale: number;
  error: string | null;
};

export function partsMode(settings: ProductSettings) {
  if (settings.housingShape !== "custom" || !imageParts(settings.housingLogo)) return false;
  // Whole caps make the entire picture one cap; by parts needs at least one picked part.
  return settings.partCaps !== "parts" || settings.housingParts.length > 0;
}

function polygonsOf(paths: Paths): Polygon[] {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return ClipperLib.JS.PolyTreeToExPolygons(tree).map((polygon) => {
    const outer = fromPath(polygon.outer);
    const holes = polygon.holes.map(fromPath);
    return [signedArea(outer) < 0 ? outer.reverse() : outer, ...holes.map((hole) => (signedArea(hole) > 0 ? hole.reverse() : hole))];
  });
}

function insideRings(point: Pt, rings: Pt[][]) {
  let inside = false;
  for (const ring of rings) {
    for (let index = 0, last = ring.length - 1; index < ring.length; last = index, index += 1) {
      const a = ring[index];
      const b = ring[last];
      if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

function edgeDistance(point: Pt, rings: Pt[][]) {
  let best = Infinity;
  for (const ring of rings) {
    for (let index = 0, last = ring.length - 1; index < ring.length; last = index, index += 1) {
      const a = ring[last];
      const b = ring[index];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = clampUnit(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1));
      best = Math.min(best, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
    }
  }
  return best;
}

function centroid(ring: Pt[]): Pt {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0, last = ring.length - 1; index < ring.length; last = index, index += 1) {
    const a = ring[last];
    const b = ring[index];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  return area ? { x: x / (3 * area), y: y / (3 * area) } : ring[0] ?? { x: 0, y: 0 };
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

const partLayouts = new Map<string, PartsLayout>();

export function partsLayout(logoId: string, groups: number[][], size: number, caps: PartCaps = "whole"): PartsLayout | null {
  const parts = imageParts(logoId);
  if (!parts) return null;
  const key = JSON.stringify([logoId, groups, size, caps]);
  const cached = partLayouts.get(key);
  if (cached) return cached;
  const layout = computePartsLayout(parts, groups, size, caps);
  if (partLayouts.size > 40) partLayouts.delete(partLayouts.keys().next().value!);
  partLayouts.set(key, layout);
  return layout;
}

// Image units times 100, so clipper's integer grid stays fine.
const PU = 100;

function computePartsLayout(parts: ImagePart[], groups: number[][], size: number, caps: PartCaps): PartsLayout {
  const scaled = parts.map((part) => part.rings.map((ring) => moved(ring, 0, 0, PU)));
  const close = (paths: Paths, radius: number) => offset(offset(paths, radius), -radius);
  const silhouette = largest(close(run(ClipperLib.ClipType.ctUnion, scaled.flat().map(toPath)), 0.6));
  const valid =
    caps === "whole"
      ? [parts.map((_, index) => index)]
      : groups.map((group) => group.filter((index) => index >= 0 && index < parts.length)).filter((group) => group.length);

  const postNeed = PART.post + PART.postWall + PART.gap;
  const socketNeed = (PART.chamber / 2 + PART.wall) * Math.SQRT2;
  // Whole caps: one cap, the picture's whole outline.
  const shapePaths =
    caps === "whole"
      ? [[toPath(silhouette)]]
      : valid.map((group) => close(group.flatMap((index) => scaled[index].map(toPath)), 0.3));
  const shapes = shapePaths.map(polygonsOf);
  type Spot = { point: Pt; room: number };
  const grid = (rings: Pt[][], steps: number) => {
    const box = bounds(rings.flat());
    const cells: Spot[] = [];
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps; j += 1) {
        const point = { x: box.minX + ((box.maxX - box.minX) * i) / steps, y: box.minY + ((box.maxY - box.minY) * j) / steps };
        if (insideRings(point, rings)) cells.push({ point, room: edgeDistance(point, rings) });
      }
    }
    return cells;
  };

  // Centered: the middle of the part's biggest piece, among spots with nearly the most room.
  const centered = shapes.map((polygons): Spot => {
    const piece = polygons.reduce<Polygon>(
      (best, polygon) => (Math.abs(signedArea(polygon[0])) > Math.abs(signedArea(best[0] ?? [])) ? polygon : best),
      [],
    );
    const cells = grid(piece, 60);
    if (!cells.length) return { point: { x: 0, y: 0 }, room: 0 };
    const most = Math.max(...cells.map((cell) => cell.room));
    const middle = centroid(piece[0]);
    return cells
      .filter((cell) => cell.room >= most * 0.85)
      .reduce((best, cell) =>
        Math.hypot(cell.point.x - middle.x, cell.point.y - middle.y) < Math.hypot(best.point.x - middle.x, best.point.y - middle.y)
          ? cell
          : best,
      );
  });

  // Balanced: off center if that lets the socket sit deeper inside the silhouette.
  const balanced = shapes.map((polygons): Spot => {
    const rings = polygons.flat();
    const need = (spot: Spot) => Math.max(postNeed / spot.room, socketNeed / edgeDistance(spot.point, [silhouette]));
    const cells = grid(rings, 40);
    if (!cells.length) return { point: { x: 0, y: 0 }, room: 0 };
    let best = cells.reduce((a, b) => (need(b) < need(a) ? b : a));
    const box = bounds(rings.flat());
    const stepX = (box.maxX - box.minX) / 40;
    const stepY = (box.maxY - box.minY) / 40;
    const center = best.point;
    for (let i = -6; i <= 6; i += 1) {
      for (let j = -6; j <= 6; j += 1) {
        const point = { x: center.x + (i / 6) * stepX, y: center.y + (j / 6) * stepY };
        if (!insideRings(point, rings)) continue;
        const spot = { point, room: edgeDistance(point, rings) };
        if (need(spot) < need(best)) best = spot;
      }
    }
    return best;
  });

  // Millimeters per PU: big enough for every stem, then for every socket inside the outline.
  const spacing = PART.chamber + PART.wall;
  const grown = PART.chamber + PART.wall * 2;
  // Millimeters per PU are sized so the housing's longer side is `size` mm.
  const silhouetteBox = bounds(silhouette);
  const extent = Math.max(silhouetteBox.maxX - silhouetteBox.minX, silhouetteBox.maxY - silhouetteBox.minY);
  const limit = PART.maxSize / extent;
  // A whole cap reaches past the picture by its border.
  const capGrowth = caps === "whole" ? PART.capBorder + PART.gap : 0;
  const scaleFor = (spots: Spot[]) => {
    let low = Math.max(0, size - 2 * (PART.border + PART.lidFit + capGrowth)) / extent;
    for (const spot of spots) low = Math.max(low, spot.room > 0 ? postNeed / spot.room : Infinity);
    spots.forEach((a, i) =>
      spots.slice(i + 1).forEach((b) => {
        const apart = Math.max(Math.abs(a.point.x - b.point.x), Math.abs(a.point.y - b.point.y));
        low = Math.max(low, apart > 0 ? spacing / apart : Infinity);
      }),
    );
    const fits = (mm: number) =>
      contains(
        [toPath(moved(silhouette, 0, 0, mm))],
        spots.map((spot) => toPath(roundedRectRing(spot.point.x * mm, spot.point.y * mm, grown, grown, 1, 2))),
        0.01,
      );
    if (!Number.isFinite(low) || low > limit || !fits(limit)) return Infinity;
    if (fits(low)) return low;
    let high = limit;
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) high = mid;
      else low = mid;
    }
    return high;
  };

  // Keep switches centered unless that grows the housing more than 15%.
  const target = scaleFor(balanced);
  const spots = centered.slice();
  let mm = scaleFor(spots);
  const shifted = new Set<number>();
  while (Number.isFinite(target) && mm > target * 1.15 && shifted.size < spots.length) {
    let pick = -1;
    let pickScale = Infinity;
    spots.forEach((_, index) => {
      if (shifted.has(index)) return;
      const trial = spots.map((spot, other) => (other === index ? balanced[index] : spot));
      const scale = scaleFor(trial);
      if (pick < 0 || scale < pickScale) {
        pick = index;
        pickScale = scale;
      }
    });
    shifted.add(pick);
    spots[pick] = balanced[pick];
    mm = pickScale;
  }
  if (!Number.isFinite(mm)) mm = target;

  const empty = (error: string): PartsLayout => ({
    outline: [],
    recess: [],
    pocket: [],
    positions: [],
    keys: [],
    lid: [],
    inlays: [],
    scale: 0,
    error,
  });
  if (!Number.isFinite(mm)) {
    return empty("A picked part is too thin to hold a switch. Pick a bigger part, or Shift+click to join it with the part next to it.");
  }

  // The picture keeps its own outline: the lid and caps fill it, and the rim goes around it.
  const picture = [toPath(moved(silhouette, 0, 0, mm))];
  const inside = capGrowth ? [toPath(largest(offset(picture, capGrowth)))] : picture;
  const recess = largest(offset(inside, PART.lidFit));
  const outline = smoothRing(largest(offset([toPath(recess)], PART.border)), 1.2);
  const positions = spots.map((spot) => ({ x: spot.point.x * mm, y: spot.point.y * mm }));
  // Only the piece under the switch becomes the cap; detached joined pieces stay in the lid.
  const pieces = shapes.map((polygons, index) => {
    const piece = polygons.find((polygon) => insideRings(spots[index].point, polygon)) ?? polygons[0] ?? [];
    return run(ClipperLib.ClipType.ctIntersection, piece.map((ring) => toPath(moved(ring, 0, 0, mm))), picture);
  });
  // Each hole reaches past its piece by the cap border, without crowding the other caps.
  const holes: Paths[] = [];
  pieces.forEach((piece, index) => {
    let hole = run(ClipperLib.ClipType.ctIntersection, offset(piece, PART.capBorder + PART.gap), inside);
    const others = pieces.filter((_, other) => other !== index).flat();
    if (others.length) hole = run(ClipperLib.ClipType.ctDifference, hole, offset(others, PART.gap * 2));
    if (holes.length) hole = run(ClipperLib.ClipType.ctDifference, hole, offset(holes.flat(), PART.gap));
    holes.push(hole);
  });
  // The picture's colors over a region. Each part is grown a little to close the hairlines
  // between neighbors, then clipped by the parts before it so the colors never overlap.
  const partPaths = scaled.map((rings) => offset(rings.map((ring) => toPath(moved(ring, 0, 0, mm))), 0.15));
  const smallestFirst = parts.map((_, index) => index).sort((a, b) => parts[a].area - parts[b].area);
  const partBoxes = partPaths.map((paths) => {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const path of paths) {
      for (const point of path) {
        box.minX = Math.min(box.minX, point.X);
        box.minY = Math.min(box.minY, point.Y);
        box.maxX = Math.max(box.maxX, point.X);
        box.maxY = Math.max(box.maxY, point.Y);
      }
    }
    return box;
  });
  const touching = (a: number, b: number) =>
    partBoxes[a].minX <= partBoxes[b].maxX &&
    partBoxes[b].minX <= partBoxes[a].maxX &&
    partBoxes[a].minY <= partBoxes[b].maxY &&
    partBoxes[b].minY <= partBoxes[a].maxY;
  // Parts outside `own` stay back from the region's edge, so their growth can't bleed in.
  const paint = (region: Paths, own?: number[]) => {
    const byColor = new Map<string, Polygon[]>();
    const taken: { index: number; paths: Paths }[] = [];
    const inner = own ? offset(region, -0.3) : region;
    smallestFirst.forEach((index) => {
      const paths = partPaths[index];
      let piece = run(ClipperLib.ClipType.ctIntersection, paths, !own || own.includes(index) ? region : inner);
      const near = taken.filter((other) => touching(index, other.index)).flatMap((other) => other.paths);
      if (piece.length && near.length) piece = run(ClipperLib.ClipType.ctDifference, piece, near);
      if (!piece.length) return;
      taken.push({ index, paths: piece });
      // A hair of opening drops knife-edge slivers that won't extrude cleanly.
      const cleaned = ClipperLib.Clipper.CleanPolygons(offset(offset(piece, -0.04), 0.04), 0.01 * SCALE);
      const polygons = polygonsOf(cleaned).filter((polygon) => Math.abs(signedArea(polygon[0])) > PART.minDetail);
      const color = parts[index].color;
      if (polygons.length) byColor.set(color, [...(byColor.get(color) ?? []), ...polygons]);
    });
    return [...byColor.entries()].map(([color, polygons]) => ({ color, polygons }));
  };
  const keys = valid.map((group, index): PartKey => {
    const fitted = polygonsOf(offset(holes[index], -PART.gap));
    const cap = fitted.find((polygon) => insideRings(positions[index], polygon)) ?? fitted[0] ?? [];
    const face = cap.length ? run(ClipperLib.ClipType.ctIntersection, cap.map(toPath), pieces[index]) : [];
    const band = cap.length ? run(ClipperLib.ClipType.ctDifference, cap.map(toPath), face) : [];
    return {
      cap,
      parts: group,
      inlays: face.length ? paint(face, caps === "whole" ? undefined : group) : [],
      border: polygonsOf(offset(offset(band, -0.04), 0.04)).filter((polygon) => Math.abs(signedArea(polygon[0])) > PART.minDetail),
    };
  });
  if (keys.some((key) => !key.cap.length)) {
    return empty("A picked part sits under the housing rim. Pick a bigger part, or Shift+click to join it with the part next to it.");
  }
  // Opening the lid drops slivers between neighboring holes and along the rim.
  const half = PART.minFeature / 2;
  const solid = (paths: Paths) =>
    offset(offset(paths, -half), half).filter((path) => Math.abs(signedArea(fromPath(path))) > 4);
  const lidPaths = solid(run(ClipperLib.ClipType.ctDifference, inside, holes.flat()));
  return {
    outline,
    recess,
    pocket: roundedRectRing(0, 0, PART.chamber, PART.chamber, 1),
    positions,
    keys,
    lid: polygonsOf(lidPaths),
    inlays: paint(lidPaths),
    scale: mm * PU,
    error: valid.length ? null : "Click a part of the picture to make it a clicker.",
  };
}

