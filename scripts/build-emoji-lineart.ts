// Builds lib/emoji-lineart.json from OpenMoji black line art (https://openmoji.org), CC BY-SA 4.0.
import { writeFileSync } from "node:fs";
import ClipperLib from "clipper-lib";

const EMOJI: Record<string, string> = {
  smile: "1F60A",
  grin: "1F601",
  joy: "1F602",
  love: "1F60D",
  wink: "1F609",
  kiss: "1F618",
  cool: "1F60E",
  tongue: "1F61B",
  sad: "1F622",
  cry: "1F62D",
  angry: "1F620",
  wow: "1F62E",
  halo: "1F607",
  party: "1F973",
  sleep: "1F634",
  neutral: "1F610",
  stars: "1F929",
  plead: "1F97A",
  ghost: "1F47B",
  skull: "1F480",
  robot: "1F916",
  alien: "1F47D",
  fire: "1F525",
  thumb: "1F44D",
};

type Vec = { x: number; y: number };
type Stroke = { points: Vec[]; closed: boolean; width: number; fill: boolean };

const CLIP = 100;
const UNIT = 1 / 50;

function attr(source: string, name: string) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ?? null;
}

function numList(value: string) {
  return value
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((entry) => Number.isFinite(entry));
}

function dedupe(points: Vec[]) {
  const next: Vec[] = [];
  for (const point of points) {
    const last = next[next.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.015) next.push(point);
  }
  return next;
}

function cubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec) {
  const length =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const steps = Math.max(8, Math.ceil(length / 0.35));
  const points: Vec[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    points.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return points;
}

function quadratic(p0: Vec, p1: Vec, p2: Vec) {
  return cubic(p0, { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) }, { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) }, p2);
}

function angleBetween(u: Vec, v: Vec) {
  return Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
}

function arc(p0: Vec, rx: number, ry: number, degrees: number, large: number, sweep: number, p1: Vec) {
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 0.001) return [p1];
  if (rx === 0 || ry === 0) return [p1];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (degrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  const lambda = (x1 * x1) / rx2 + (y1 * y1) / ry2;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
    rx2 = rx * rx;
    ry2 = ry * ry;
  }
  const sign = large === sweep ? -1 : 1;
  const root = Math.max(0, (rx2 * ry2 - rx2 * y1 * y1 - ry2 * x1 * x1) / (rx2 * y1 * y1 + ry2 * x1 * x1));
  const coef = sign * Math.sqrt(root);
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (coef * -ry * x1) / rx;
  const center = {
    x: cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2,
    y: sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2,
  };
  const start = { x: (x1 - cx1) / rx, y: (y1 - cy1) / ry };
  const end = { x: (-x1 - cx1) / rx, y: (-y1 - cy1) / ry };
  const theta = angleBetween({ x: 1, y: 0 }, start);
  let delta = angleBetween(start, end);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const steps = Math.max(12, Math.ceil(Math.abs(delta) / (Math.PI / 48)));
  const points: Vec[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const turn = theta + delta * (step / steps);
    const ex = Math.cos(turn) * rx;
    const ey = Math.sin(turn) * ry;
    points.push({ x: cos * ex - sin * ey + center.x, y: sin * ex + cos * ey + center.y });
  }
  return points;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number) {
  const points: Vec[] = [];
  const steps = 96;
  for (let step = 0; step < steps; step += 1) {
    const turn = (step / steps) * Math.PI * 2;
    points.push({ x: cx + Math.cos(turn) * rx, y: cy + Math.sin(turn) * ry });
  }
  return points;
}

function parsePath(d: string) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let index = 0;
  let command = "";
  let cx = 0;
  let cy = 0;
  let start = { x: 0, y: 0 };
  let prevCubic: Vec | null = null;
  let prevQuad: Vec | null = null;
  const subs: { points: Vec[]; closed: boolean }[] = [];
  let current: Vec[] = [];

  const read = () => Number(tokens[index++]);
  const hasNumber = () => index < tokens.length && !/[a-zA-Z]/.test(tokens[index]);
  const push = (points: Vec[]) => {
    current.push(...points);
    const last = current[current.length - 1];
    if (last) {
      cx = last.x;
      cy = last.y;
    }
  };
  const finish = (closed: boolean) => {
    const points = dedupe(current);
    if (points.length >= 2) subs.push({ points, closed });
    current = [];
  };

  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const here = { x: cx, y: cy };
    if (command === "M" || command === "m") {
      if (current.length) finish(false);
      const x = read();
      const y = read();
      cx = relative ? cx + x : x;
      cy = relative ? cy + y : y;
      start = { x: cx, y: cy };
      current = [{ x: cx, y: cy }];
      command = relative ? "l" : "L";
      prevCubic = null;
      prevQuad = null;
    } else if (command === "L" || command === "l") {
      const x = read();
      const y = read();
      push([{ x: relative ? here.x + x : x, y: relative ? here.y + y : y }]);
      prevCubic = null;
      prevQuad = null;
    } else if (command === "H" || command === "h") {
      const x = read();
      push([{ x: relative ? here.x + x : x, y: here.y }]);
      prevCubic = null;
      prevQuad = null;
    } else if (command === "V" || command === "v") {
      const y = read();
      push([{ x: here.x, y: relative ? here.y + y : y }]);
      prevCubic = null;
      prevQuad = null;
    } else if (command === "C" || command === "c") {
      const raw = [read(), read(), read(), read(), read(), read()];
      const p1 = { x: relative ? here.x + raw[0] : raw[0], y: relative ? here.y + raw[1] : raw[1] };
      const p2 = { x: relative ? here.x + raw[2] : raw[2], y: relative ? here.y + raw[3] : raw[3] };
      const p3 = { x: relative ? here.x + raw[4] : raw[4], y: relative ? here.y + raw[5] : raw[5] };
      push(cubic(here, p1, p2, p3));
      prevCubic = p2;
      prevQuad = null;
    } else if (command === "S" || command === "s") {
      const raw = [read(), read(), read(), read()];
      const p1 = prevCubic ? { x: 2 * here.x - prevCubic.x, y: 2 * here.y - prevCubic.y } : here;
      const p2 = { x: relative ? here.x + raw[0] : raw[0], y: relative ? here.y + raw[1] : raw[1] };
      const p3 = { x: relative ? here.x + raw[2] : raw[2], y: relative ? here.y + raw[3] : raw[3] };
      push(cubic(here, p1, p2, p3));
      prevCubic = p2;
      prevQuad = null;
    } else if (command === "Q" || command === "q") {
      const raw = [read(), read(), read(), read()];
      const p1 = { x: relative ? here.x + raw[0] : raw[0], y: relative ? here.y + raw[1] : raw[1] };
      const p2 = { x: relative ? here.x + raw[2] : raw[2], y: relative ? here.y + raw[3] : raw[3] };
      push(quadratic(here, p1, p2));
      prevQuad = p1;
      prevCubic = null;
    } else if (command === "T" || command === "t") {
      const raw = [read(), read()];
      const p1: Vec = prevQuad ? { x: 2 * here.x - prevQuad.x, y: 2 * here.y - prevQuad.y } : here;
      const p2 = { x: relative ? here.x + raw[0] : raw[0], y: relative ? here.y + raw[1] : raw[1] };
      push(quadratic(here, p1, p2));
      prevQuad = p1;
      prevCubic = null;
    } else if (command === "A" || command === "a") {
      const rx = read();
      const ry = read();
      const rotation = read();
      const large = read();
      const sweep = read();
      const x = read();
      const y = read();
      const end = { x: relative ? here.x + x : x, y: relative ? here.y + y : y };
      push(arc(here, rx, ry, rotation, large, sweep, end));
      prevCubic = null;
      prevQuad = null;
    } else if (command === "Z" || command === "z") {
      if (current.length) current.push({ ...start });
      finish(true);
      cx = start.x;
      cy = start.y;
      prevCubic = null;
      prevQuad = null;
    } else if (!hasNumber()) {
      throw new Error(`Unsupported path command ${command}`);
    }
  }
  if (current.length) finish(false);
  return subs;
}

function strokesFromSvg(svg: string): Stroke[] {
  const body = svg.replace(/<defs[\s\S]*?<\/defs>/gi, "");
  const strokes: Stroke[] = [];
  const tags = body.match(/<(circle|ellipse|line|polygon|polyline|rect|path)\b[^>]*\/?>/gi) ?? [];
  for (const tag of tags) {
    const kind = tag.match(/^<([a-z]+)/i)?.[1]?.toLowerCase() ?? "";
    const stroke = attr(tag, "stroke");
    const fill = attr(tag, "fill");
    const width = Number(attr(tag, "stroke-width") ?? "2") || 2;
    const stroked = Boolean(stroke && stroke !== "none");
    const filled = fill !== "none" && !stroked;
    if (kind === "circle" || kind === "ellipse") {
      const rx = Number(kind === "circle" ? attr(tag, "r") : attr(tag, "rx"));
      const ry = Number(kind === "circle" ? attr(tag, "r") : attr(tag, "ry"));
      const points = ellipsePoints(Number(attr(tag, "cx") ?? 0), Number(attr(tag, "cy") ?? 0), rx, ry);
      if (stroked) strokes.push({ points, closed: true, width, fill: false });
      else if (filled || fill === null) strokes.push({ points, closed: true, width, fill: true });
    } else if (kind === "line") {
      strokes.push({
        points: [
          { x: Number(attr(tag, "x1")), y: Number(attr(tag, "y1")) },
          { x: Number(attr(tag, "x2")), y: Number(attr(tag, "y2")) },
        ],
        closed: false,
        width,
        fill: false,
      });
    } else if (kind === "polygon" || kind === "polyline" || kind === "rect") {
      let points: Vec[] = [];
      if (kind === "rect") {
        const x = Number(attr(tag, "x") ?? 0);
        const y = Number(attr(tag, "y") ?? 0);
        const w = Number(attr(tag, "width") ?? 0);
        const h = Number(attr(tag, "height") ?? 0);
        points = [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ];
      } else {
        const values = numList(attr(tag, "points") ?? "");
        for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
      }
      const closed = kind !== "polyline";
      if (stroked) strokes.push({ points, closed, width, fill: false });
      else strokes.push({ points, closed: true, width, fill: true });
    } else if (kind === "path") {
      const data = attr(tag, "d");
      if (!data) continue;
      for (const sub of parsePath(data)) {
        const begin = sub.points[0];
        const end = sub.points[sub.points.length - 1];
        const closed =
          sub.closed || Boolean(begin && end && Math.hypot(end.x - begin.x, end.y - begin.y) < 0.35);
        if (stroked) strokes.push({ points: sub.points, closed, width, fill: false });
        else if (closed) strokes.push({ points: sub.points, closed: true, width, fill: true });
      }
    }
  }
  return strokes;
}

function toClip(points: Vec[]) {
  const path: { X: number; Y: number }[] = [];
  for (const point of points) {
    const next = { X: Math.round(point.x * CLIP), Y: Math.round(point.y * CLIP) };
    const last = path[path.length - 1];
    if (!last || last.X !== next.X || last.Y !== next.Y) path.push(next);
  }
  if (path.length > 2 && path[0].X === path[path.length - 1].X && path[0].Y === path[path.length - 1].Y) path.pop();
  return path;
}

function strokePaths(stroke: Stroke) {
  const path = toClip(stroke.points);
  if (path.length < 2) return [];
  if (stroke.fill) return path.length >= 3 ? [path] : [];
  const offset = new ClipperLib.ClipperOffset(2, 0.03 * CLIP);
  offset.AddPath(
    path,
    ClipperLib.JoinType.jtRound,
    stroke.closed ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenRound,
  );
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, (stroke.width / 2) * CLIP);
  return solution;
}

function unionAll(paths: { X: number; Y: number }[][]) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return ClipperLib.Clipper.CleanPolygons(ClipperLib.Clipper.PolyTreeToPaths(tree), 0.02 * CLIP);
}

function toUnit(paths: { X: number; Y: number }[][]) {
  return paths
    .filter((path) => path.length >= 3)
    .map((path) =>
      path.map((point) => [
        Number((((point.X / CLIP - 36) * UNIT).toFixed(4))),
        Number((((36 - point.Y / CLIP) * UNIT).toFixed(4))),
      ]),
    );
}

async function main() {
  const library: Record<string, number[][][]> = {};
  for (const [id, code] of Object.entries(EMOJI)) {
    const response = await fetch(`https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/black/svg/${code}.svg`);
    if (!response.ok) throw new Error(`${id} ${code} returned ${response.status}`);
    const svg = await response.text();
    const pieces = strokesFromSvg(svg).flatMap(strokePaths);
    if (!pieces.length) throw new Error(`${id} produced no lines`);
    const rings = toUnit(unionAll(pieces));
    library[id] = rings;
    const points = rings.reduce((sum, ring) => sum + ring.length, 0);
    console.log(`${id} ${code} rings=${rings.length} points=${points}`);
  }
  writeFileSync(
    "lib/emoji-lineart.json",
    `${JSON.stringify(library)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
