import ClipperLib from "clipper-lib";
import type { Paths } from "clipper-lib";
import { registerLogo } from "./charms";

export type Pt = { x: number; y: number };

// One color region of an imported image: an outer ring (counterclockwise) and its holes,
// centered on the whole image with its longer side 0.98 long, y up.
export type ImagePart = { color: string; rings: Pt[][]; area: number };

const SCALE = 100000;
const store = new Map<string, ImagePart[]>();

export function imageParts(id: string) {
  return store.get(id) ?? null;
}

// The largest part's color, the natural color for the housing itself.
export function mainColor(parts: ImagePart[]) {
  const totals = new Map<string, number>();
  for (const part of parts) totals.set(part.color, (totals.get(part.color) ?? 0) + part.area);
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#cccccc";
}

// Registers the image's filled silhouette as a logo, so it works as a housing outline,
// and keeps its color parts under the same id.
export function registerImageParts(parts: ImagePart[], preview = "") {
  const paths = parts.flatMap((part) =>
    part.rings.map((ring) => ring.map((point) => ({ X: Math.round(point.x * SCALE), Y: Math.round(point.y * SCALE) }))),
  );
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  // Closing seals the hairline gaps left between neighboring colors.
  const gap = 0.006 * SCALE;
  const grow = (input: Paths, delta: number) => {
    const offset = new ClipperLib.ClipperOffset(2, SCALE * 0.0005);
    offset.AddPaths(input, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const out = new ClipperLib.Paths();
    offset.Execute(out, delta);
    return out;
  };
  const silhouette = grow(grow(ClipperLib.Clipper.PolyTreeToPaths(tree), gap), -gap);
  const rings = silhouette.map((path) => path.map((point): [number, number] => [point.X / SCALE, point.Y / SCALE]));
  const id = registerLogo(rings, preview);
  store.set(id, parts);
  return id;
}
