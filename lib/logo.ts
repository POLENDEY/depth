import ClipperLib from "clipper-lib";
import type { Path, Paths } from "clipper-lib";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { registerLogo } from "./charms";

type Ring = [number, number][];

const GRID = 10000;
const RASTER = 320;
const MAX_BYTES = 5 * 1024 * 1024;
const EVEN_ODD = 0;

export async function importLogo(file: File) {
  if (file.size > MAX_BYTES) throw new Error("That logo is larger than 5 MB.");
  const name = file.name.toLowerCase();
  const isSvg = file.type === "image/svg+xml" || name.endsWith(".svg");
  const isPng = file.type === "image/png" || name.endsWith(".png");
  if (!isSvg && !isPng) throw new Error("Use an SVG or PNG logo.");
  const preview = await readDataUrl(file);
  const rings = isSvg ? svgRings(await file.text()) : await pngRings(preview);
  if (!rings.length) throw new Error("No solid shapes were found in that logo.");
  return registerLogo(rings, preview);
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
      for (const shape of SVGLoader.createShapes(path)) {
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

async function pngRings(url: string) {
  const image = await loadImage(url);
  const fit = Math.min(1, RASTER / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * fit));
  const height = Math.max(1, Math.round(image.naturalHeight * fit));
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
  const ink = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    if (transparent) return pixels[at + 3] >= 128;
    return Math.hypot(pixels[at] - bgR, pixels[at + 1] - bgG, pixels[at + 2] - bgB) > 70;
  };

  const cell = GRID / Math.max(width, height);
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
  const merged = unionAll(runs);
  const smooth = merged
    .filter((path) => Math.abs(area(path)) > cell * cell * 6)
    .map((path) => simplify(path, cell * 0.8))
    .filter((path) => path.length >= 3);
  return normalize(unionAll(smooth), false);
}

function normalize(paths: Paths, flipY: boolean) {
  const polygons = ClipperLib.JS.PolyTreeToExPolygons(tree(paths)) as { outer: Path; holes: Path[] }[];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const point of polygon.outer) {
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

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That PNG could not be read."));
    image.src = url;
  });
}
