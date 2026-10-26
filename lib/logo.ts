import ClipperLib from "clipper-lib";
import type { Path, Paths } from "clipper-lib";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { registerLogo } from "./charms";

type Ring = [number, number][];

const GRID = 10000;
const RASTER = 320;
const SMOOTH_RASTER = 480;
const ORIGINAL_RASTER = 1024;
const MAX_BYTES = 50 * 1024 * 1024;
const THUMB = 96;
const EVEN_ODD = 0;

export type LogoEdges = "original" | "sharp" | "smooth" | "extra";

export const LOGO_EDGES: { value: LogoEdges; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "sharp", label: "As is (pixel edges)" },
  { value: "smooth", label: "Smooth" },
  { value: "extra", label: "Extra smooth" },
];

const BLUR: Record<"smooth" | "extra", number> = { smooth: 2, extra: 4.5 };
// Blur relative to the art's own pixel size. Much above 0.6 one-pixel lines fade out and
// one-pixel gaps fill in.
const BLOCK_BLUR: Record<"smooth" | "extra", number> = { smooth: 0.42, extra: 0.52 };
// Pixels darker than this count as line art; fills like yellow or light gray do not.
const LINE_LIGHT = 130;

export type LogoTrace = "lines" | "fill";

export const LOGO_TRACES: { value: LogoTrace; label: string }[] = [
  { value: "lines", label: "Line art only" },
  { value: "fill", label: "Whole image" },
];

// `emoji` is set when the logo is the line art of a built-in emoji, so it can switch back.
type LogoSource = { file: File; edges: LogoEdges; trace: LogoTrace; emoji?: string };
const sources = new Map<string, LogoSource>();

export function logoSource(id: string) {
  const source = sources.get(id);
  return source ? { edges: source.edges, trace: source.trace, emoji: source.emoji ?? null } : null;
}

export async function reconvertLogo(id: string, options: { edges?: LogoEdges; trace?: LogoTrace }) {
  const source = sources.get(id);
  if (!source) throw new Error("That logo is no longer loaded. Import it again.");
  const next = await importLogo(source.file, options.edges ?? source.edges, options.trace ?? source.trace);
  if (source.emoji) sources.set(next, { ...sources.get(next)!, emoji: source.emoji });
  return next;
}

export async function importLogo(file: File, edges: LogoEdges = "smooth", trace: LogoTrace = "lines") {
  const id = await convertLogo(file, edges, trace);
  sources.set(id, { file, edges, trace });
  return id;
}

export async function emojiLineArt(emoji: string, edges: LogoEdges = "smooth") {
  const response = await fetch(`/emoji/${emoji}.svg`);
  if (!response.ok) throw new Error("Could not load that emoji.");
  const file = new File([await response.blob()], `${emoji}.svg`, { type: "image/svg+xml" });
  const id = await importLogo(file, edges, "lines");
  sources.set(id, { ...sources.get(id)!, emoji });
  return id;
}

async function convertLogo(file: File, edges: LogoEdges, trace: LogoTrace) {
  if (file.size > MAX_BYTES) throw new Error("That logo is larger than 50 MB.");
  const name = file.name.toLowerCase();
  const isSvg = file.type === "image/svg+xml" || name.endsWith(".svg");
  const isPng = file.type === "image/png" || name.endsWith(".png");
  if (!isSvg && !isPng) throw new Error("Use an SVG or PNG logo.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url, isSvg).catch((reason) => {
      if (isSvg) return null;
      throw reason;
    });
    let traced: { mark: Ring[]; body: Ring[] | null } = { mark: [], body: null };
    if (image && (!isSvg || trace === "lines")) traced = pngRings(image, edges, trace);
    if (isSvg && !traced.body) traced = { mark: svgRings(await file.text()), body: null };
    if (!traced.mark.length) throw new Error("No solid shapes were found in that logo.");
    return registerLogo(traced.mark, image ? thumbnail(image) : "", traced.body);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function thumbnail(image: HTMLImageElement) {
  const width = image.naturalWidth || THUMB;
  const height = image.naturalHeight || THUMB;
  const fit = Math.min(1, THUMB / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * fit));
  canvas.height = Math.max(1, Math.round(height * fit));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function svgRings(source: string) {
  let data: ReturnType<SVGLoader["parse"]>;
  try {
    data = new SVGLoader().parse(source);
  } catch {
    throw new Error("That SVG could not be read.");
  }
  type Layer = { points: { x: number; y: number }[][]; add: boolean; open: boolean; width: number };
  const layers: Layer[] = [];
  for (const path of data.paths) {
    const style = (path.userData?.style ?? {}) as Record<string, string | number | undefined>;
    const fill = String(style.fill ?? "#000");
    if (fill !== "none" && fill !== "transparent" && Number(style.fillOpacity ?? 1) > 0.05) {
      for (const shape of path.toShapes()) {
        const extracted = shape.extractPoints(16);
        layers.push({ points: [extracted.shape, ...extracted.holes], add: !isWhite(fill), open: false, width: 0 });
      }
    }
    const stroke = String(style.stroke ?? "none");
    const strokeWidth = Number(style.strokeWidth ?? 1);
    if (stroke !== "none" && stroke !== "transparent" && strokeWidth > 0 && Number(style.strokeOpacity ?? 1) > 0.05) {
      for (const sub of path.subPaths) {
        const points = sub.getPoints(16);
        if (points.length < 2) continue;
        const first = points[0];
        const last = points[points.length - 1];
        const closed = sub.autoClose || Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
        layers.push({ points: [points], add: !isWhite(stroke), open: !closed, width: strokeWidth });
      }
    }
  }
  if (!layers.length) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    if (!layer.add) continue;
    const pad = layer.width / 2;
    for (const ring of layer.points) {
      for (const point of ring) {
        minX = Math.min(minX, point.x - pad);
        minY = Math.min(minY, point.y - pad);
        maxX = Math.max(maxX, point.x + pad);
        maxY = Math.max(maxY, point.y + pad);
      }
    }
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0) return [];
  const scale = GRID / span;
  const toPath = (ring: { x: number; y: number }[]): Path =>
    ring.map((point) => ({ X: Math.round((point.x - minX) * scale), Y: Math.round((point.y - minY) * scale) }));

  let solid: Paths = [];
  for (const layer of layers) {
    let piece: Paths;
    if (layer.width > 0) {
      const offset = new ClipperLib.ClipperOffset(2, GRID * 0.0005);
      const paths = layer.points.map(toPath);
      offset.AddPaths(
        paths,
        ClipperLib.JoinType.jtRound,
        layer.open ? ClipperLib.EndType.etOpenRound : ClipperLib.EndType.etClosedLine,
      );
      piece = new ClipperLib.Paths();
      offset.Execute(piece, (layer.width / 2) * scale);
    } else {
      piece = unionAll(layer.points.map(toPath), EVEN_ODD);
    }
    if (!piece.length) continue;
    solid = layer.add ? unionAll([...solid, ...piece]) : clip(solid, piece);
  }
  return normalize(solid, true);
}

function pngRings(image: HTMLImageElement, edges: LogoEdges, trace: LogoTrace) {
  const raster = edges === "sharp" ? RASTER : edges === "original" ? ORIGINAL_RASTER : SMOOTH_RASTER;
  const naturalWidth = image.naturalWidth || raster;
  const naturalHeight = image.naturalHeight || raster;
  const longest = Math.max(naturalWidth, naturalHeight);
  // Original keeps the image's own resolution; SVGs have none, so they render at the cap.
  const fit = edges === "smooth" || edges === "extra" ? raster / longest : Math.min(1, raster / longest);
  const width = Math.max(1, Math.round(naturalWidth * fit));
  const height = Math.max(1, Math.round(naturalHeight * fit));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read PNG images.");
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  let clear = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 200) clear += 1;
  const transparent = clear > width * height * 0.02;
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let edge = 0;
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) {
      const at = (y * width + x) * 4;
      bgR += pixels[at];
      bgG += pixels[at + 1];
      bgB += pixels[at + 2];
      edge += 1;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (const x of [0, width - 1]) {
      const at = (y * width + x) * 4;
      bgR += pixels[at];
      bgG += pixels[at + 1];
      bgB += pixels[at + 2];
      edge += 1;
    }
  }
  bgR /= edge;
  bgG /= edge;
  bgB /= edge;
  const coverage = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    if (transparent) return pixels[at + 3] / 255;
    const distance = Math.hypot(pixels[at] - bgR, pixels[at + 1] - bgG, pixels[at + 2] - bgB);
    return Math.min(1, Math.max(0, (distance - 40) / 60));
  };
  const darkness = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    const alpha = pixels[at + 3] / 255;
    const light = 0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2];
    return alpha * Math.min(1, Math.max(0, (LINE_LIGHT - light) / 50));
  };

  const shape = traceField(width, height, coverage, edges);
  if (trace === "fill") return { mark: normalize(shape, false), body: null };
  const lines = traceField(width, height, darkness, edges);
  const inked = (paths: Paths) => Math.abs(paths.reduce((sum, path) => sum + area(path), 0));
  if (!lines.length || inked(lines) < inked(shape) * 0.01) return { mark: normalize(shape, false), body: null };
  const outline = unionAll([...shape, ...lines]).filter((path) => area(path) > 0);
  return { mark: normalize(lines, false, outline), body: normalize(outline, false) };
}

function traceField(width: number, height: number, coverage: (x: number, y: number) => number, edges: LogoEdges) {
  const ink = (x: number, y: number) => coverage(x, y) >= 0.5;
  const cell = GRID / Math.max(width, height);
  // Follow the image's own anti-aliased edges: no blur, and corners stay sharp.
  if (edges === "original") return smoothRings(width, height, coverage, 0, cell);
  if (edges !== "sharp") {
    const block = pixelBlock(width, height, ink);
    const sigma = Math.max(BLUR[edges] * (SMOOTH_RASTER / RASTER), block * BLOCK_BLUR[edges]);
    return smoothRings(width, height, coverage, sigma, cell);
  }
  const runs: Paths = [];
  for (let y = 0; y < height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      const on = x < width && ink(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        const x0 = Math.round(start * cell);
        const x1 = Math.round(x * cell);
        const y0 = Math.round((height - y - 1) * cell);
        const y1 = Math.round((height - y) * cell);
        runs.push([
          { X: x0, Y: y0 },
          { X: x1, Y: y0 },
          { X: x1, Y: y1 },
          { X: x0, Y: y1 },
        ]);
        start = -1;
      }
    }
  }
  if (!runs.length) return [];
  const merged = unionAll(runs).filter((path) => Math.abs(area(path)) > cell * cell * 6);
  return ClipperLib.Clipper.CleanPolygons(merged, cell * 0.1);
}

// Size of the art's "pixels" after scaling: the shortest run of ink or gap that shows up
// often. Pixel art upscaled 20x gives 20; a clean high-res logo gives a small number.
function pixelBlock(width: number, height: number, ink: (x: number, y: number) => boolean) {
  const counts = new Map<number, number>();
  let total = 0;
  const add = (length: number) => {
    counts.set(length, (counts.get(length) ?? 0) + 1);
    total += 1;
  };
  for (let y = 0; y < height; y += 1) {
    let start = 0;
    for (let x = 1; x <= width; x += 1) {
      if (x < width && ink(x, y) === ink(x - 1, y)) continue;
      if (start > 0 && x < width) add(x - start);
      start = x;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let start = 0;
    for (let y = 1; y <= height; y += 1) {
      if (y < height && ink(x, y) === ink(x, y - 1)) continue;
      if (start > 0 && y < height) add(y - start);
      start = y;
    }
  }
  if (!total) return 1;
  const limit = Math.max(width, height) / 8;
  for (let length = 1; length <= limit; length += 1) {
    const near = (counts.get(length - 1) ?? 0) + (counts.get(length) ?? 0) + (counts.get(length + 1) ?? 0);
    if (near >= total * 0.03) return length;
  }
  return 1;
}

// Blur the ink coverage, trace the 50% contour with marching squares, then straighten
// the leftover stair steps and round them off.
function smoothRings(
  width: number,
  height: number,
  coverage: (x: number, y: number) => number,
  sigma: number,
  cell: number,
) {
  const pad = Math.ceil(sigma * 2) + 1;
  const w = width + pad * 2;
  const h = height + pad * 2;
  let field = new Float32Array(w * h);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) field[(y + pad) * w + x + pad] = coverage(x, y);
  }
  if (sigma > 0) field = blur(field, w, h, sigma);

  const iso = 0.5;
  const points = new Map<string, [number, number]>();
  const links = new Map<string, string[]>();
  const value = (x: number, y: number) => field[y * w + x];
  const edgePoint = (key: string, ax: number, ay: number, bx: number, by: number) => {
    if (!points.has(key)) {
      const va = value(ax, ay);
      const vb = value(bx, by);
      const t = Math.abs(vb - va) < 1e-6 ? 0.5 : (iso - va) / (vb - va);
      points.set(key, [ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return key;
  };
  const connect = (a: string, b: string) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };

  for (let y = 0; y < h - 1; y += 1) {
    for (let x = 0; x < w - 1; x += 1) {
      const tl = value(x, y) >= iso ? 8 : 0;
      const tr = value(x + 1, y) >= iso ? 4 : 0;
      const br = value(x + 1, y + 1) >= iso ? 2 : 0;
      const bl = value(x, y + 1) >= iso ? 1 : 0;
      const code = tl | tr | br | bl;
      if (code === 0 || code === 15) continue;
      const top = () => edgePoint(`${x},${y},h`, x, y, x + 1, y);
      const right = () => edgePoint(`${x + 1},${y},v`, x + 1, y, x + 1, y + 1);
      const bottom = () => edgePoint(`${x},${y + 1},h`, x, y + 1, x + 1, y + 1);
      const left = () => edgePoint(`${x},${y},v`, x, y, x, y + 1);
      const center = (value(x, y) + value(x + 1, y) + value(x + 1, y + 1) + value(x, y + 1)) / 4 >= iso;
      switch (code) {
        case 1:
        case 14:
          connect(left(), bottom());
          break;
        case 2:
        case 13:
          connect(bottom(), right());
          break;
        case 3:
        case 12:
          connect(left(), right());
          break;
        case 4:
        case 11:
          connect(top(), right());
          break;
        case 6:
        case 9:
          connect(top(), bottom());
          break;
        case 7:
        case 8:
          connect(left(), top());
          break;
        case 5:
          if (center) {
            connect(left(), top());
            connect(bottom(), right());
          } else {
            connect(top(), right());
            connect(left(), bottom());
          }
          break;
        case 10:
          if (center) {
            connect(top(), right());
            connect(left(), bottom());
          } else {
            connect(left(), top());
            connect(bottom(), right());
          }
          break;
      }
    }
  }

  const loops: Paths = [];
  const used = new Set<string>();
  for (const startKey of links.keys()) {
    if (used.has(startKey)) continue;
    const loop: Path = [];
    let previous = "";
    let current = startKey;
    while (current && !used.has(current)) {
      used.add(current);
      const [px, py] = points.get(current)!;
      loop.push({ X: Math.round((px - pad) * cell), Y: Math.round((height + pad - py) * cell) });
      const next = (links.get(current) ?? []).find((key) => key !== previous && !used.has(key));
      previous = current;
      current = next ?? "";
    }
    if (loop.length >= 3 && Math.abs(area(loop)) > cell * cell * 6) loops.push(loop);
  }

  const smoothed = loops
    .map((loop) => (sigma > 0 ? chaikin(simplify(loop, cell * Math.max(0.35, sigma * 0.22)), 3) : simplify(loop, cell * 0.2)))
    .filter((loop) => loop.length >= 3);
  return unionAll(smoothed, EVEN_ODD);
}

function blur(field: Float32Array, w: number, h: number, sigma: number) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(weight);
    total += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= total;
  const pass = (source: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(source.length);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const sy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          sum += source[sy * w + sx] * kernel[k + radius];
        }
        out[y * w + x] = sum;
      }
    }
    return out;
  };
  return pass(pass(field, true), false);
}

function chaikin(path: Path, rounds: number): Path {
  let current = path;
  for (let round = 0; round < rounds; round += 1) {
    const next: Path = [];
    for (let index = 0; index < current.length; index += 1) {
      const a = current[index];
      const b = current[(index + 1) % current.length];
      next.push({ X: Math.round(a.X * 0.75 + b.X * 0.25), Y: Math.round(a.Y * 0.75 + b.Y * 0.25) });
      next.push({ X: Math.round(a.X * 0.25 + b.X * 0.75), Y: Math.round(a.Y * 0.25 + b.Y * 0.75) });
    }
    current = next;
  }
  return current;
}

// `frame` sets the scale and center, so layers traced separately stay lined up.
function normalize(paths: Paths, flipY: boolean, frame: Paths = paths) {
  const polygons = ClipperLib.JS.PolyTreeToExPolygons(tree(paths)) as { outer: Path; holes: Path[] }[];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of frame) {
    for (const point of path) {
      minX = Math.min(minX, point.X);
      minY = Math.min(minY, point.Y);
      maxX = Math.max(maxX, point.X);
      maxY = Math.max(maxY, point.Y);
    }
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0) return [];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const unit = 0.98 / span;
  const place = (path: Path, outer: boolean): Ring => {
    const ring: Ring = path.map((point) => [
      Number(((point.X - cx) * unit).toFixed(5)),
      Number(((flipY ? cy - point.Y : point.Y - cy) * unit).toFixed(5)),
    ]);
    const area = ring.reduce((sum, [x1, y1], index) => {
      const [x2, y2] = ring[(index + 1) % ring.length];
      return sum + x1 * y2 - x2 * y1;
    }, 0);
    return area > 0 === outer ? ring : ring.reverse();
  };
  return polygons.flatMap((polygon) => [place(polygon.outer, true), ...polygon.holes.map((hole) => place(hole, false))]);
}

function tree(paths: Paths) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const result = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    result,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return result;
}

function unionAll(paths: Paths, fill: number = ClipperLib.PolyFillType.pftNonZero) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const result = new ClipperLib.PolyTree();
  clipper.Execute(ClipperLib.ClipType.ctUnion, result, fill, fill);
  return ClipperLib.Clipper.PolyTreeToPaths(result);
}

function clip(subject: Paths, cut: Paths) {
  if (!subject.length) return subject;
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(cut, ClipperLib.PolyType.ptClip, true);
  const result = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    result,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return ClipperLib.Clipper.PolyTreeToPaths(result);
}

function area(path: Path) {
  let sum = 0;
  for (let index = 0; index < path.length; index += 1) {
    const next = path[(index + 1) % path.length];
    sum += path[index].X * next.Y - next.X * path[index].Y;
  }
  return sum / 2;
}

// Douglas–Peucker on a closed ring, so pixel stair-steps become straight edges.
function simplify(path: Path, tolerance: number): Path {
  if (path.length < 8) return path;
  let far = 0;
  let farDistance = -1;
  for (let index = 1; index < path.length; index += 1) {
    const distance = Math.hypot(path[index].X - path[0].X, path[index].Y - path[0].Y);
    if (distance > farDistance) {
      farDistance = distance;
      far = index;
    }
  }
  const first = reduce(path.slice(0, far + 1), tolerance);
  const second = reduce([...path.slice(far), path[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function reduce(points: Path, tolerance: number): Path {
  if (points.length <= 2) return points;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.X - start.X;
  const dy = end.Y - start.Y;
  const length = Math.hypot(dx, dy) || 1;
  let worst = 0;
  let worstIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = Math.abs(dy * (points[index].X - start.X) - dx * (points[index].Y - start.Y)) / length;
    if (distance > worst) {
      worst = distance;
      worstIndex = index;
    }
  }
  if (worst <= tolerance) return [start, end];
  return [...reduce(points.slice(0, worstIndex + 1), tolerance).slice(0, -1), ...reduce(points.slice(worstIndex), tolerance)];
}

function isWhite(color: string) {
  const value = color.trim().toLowerCase();
  if (value === "white" || value === "#fff" || value === "#ffffff") return true;
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return Boolean(match && Number(match[1]) > 245 && Number(match[2]) > 245 && Number(match[3]) > 245);
}

function loadImage(url: string, svg: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(svg ? "That SVG could not be read." : "That PNG could not be read."));
    image.src = url;
  });
}
