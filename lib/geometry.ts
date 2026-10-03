import ClipperLib from "clipper-lib";
import type { Path, Paths, PolyTree } from "clipper-lib";
import type { Font, PathCommand } from "opentype.js";
import * as THREE from "three";

export type HoleSide = "left" | "right";
export type MeshQuality = "preview" | "print";

export type KeychainParams = {
  text: string;
  letterHeight: number;
  outline: number;
  holeEnabled: boolean;
  holeDiameter: number;
  holeSide: HoleSide;
  baseThickness: number;
  textThickness: number;
  charm: boolean;
};

export type KeychainModel = {
  text: THREE.BufferGeometry;
  base: THREE.BufferGeometry;
  width: number;
  height: number;
  depth: number;
  warnings: string[];
};

type Point = { x: number; y: number };
type Ring = Point[];

const SCALE = 1000;
const FUSE = 0.15;
const MAX_CHARS = 18;

export const LIMITS = {
  letterHeight: [8, 50] as const,
  outline: [0.8, 6] as const,
  holeDiameter: [3, 8] as const,
  baseThickness: [0.8, 6] as const,
  textThickness: [0.4, 4] as const,
  characters: MAX_CHARS,
};

const QUALITY = {
  preview: { maxCurveSteps: 8, circleSegments: 36, arcTolerance: 0.1 },
  print: { maxCurveSteps: 12, circleSegments: 56, arcTolerance: 0.06 },
} as const;

const profileCache = new Map<
  string,
  { textShapes: THREE.Shape[]; baseShapes: THREE.Shape[]; warnings: string[] }
>();

export function buildKeychain(
  font: Font,
  params: KeychainParams,
  quality: MeshQuality,
): KeychainModel {
  const text = params.text.normalize("NFC").slice(0, MAX_CHARS);
  if (!text.trim()) {
    throw new Error("Type a name to generate a keychain.");
  }

  const safe: KeychainParams = {
    ...params,
    text,
    letterHeight: clamp(params.letterHeight, LIMITS.letterHeight[0], LIMITS.letterHeight[1]),
    outline: clamp(params.outline, LIMITS.outline[0], LIMITS.outline[1]),
    holeDiameter: clamp(params.holeDiameter, LIMITS.holeDiameter[0], LIMITS.holeDiameter[1]),
    baseThickness: clamp(params.baseThickness, LIMITS.baseThickness[0], LIMITS.baseThickness[1]),
    textThickness: clamp(params.textThickness, LIMITS.textThickness[0], LIMITS.textThickness[1]),
  };

  const profile = getProfile(font, safe, quality);
  const textGeometry = extrude(profile.textShapes, safe.textThickness + FUSE);
  textGeometry.translate(0, 0, safe.baseThickness - FUSE);
  const baseGeometry = extrude(profile.baseShapes, safe.baseThickness);

  const box = new THREE.Box3()
    .setFromBufferAttribute(textGeometry.getAttribute("position") as THREE.BufferAttribute)
    .union(
      new THREE.Box3().setFromBufferAttribute(
        baseGeometry.getAttribute("position") as THREE.BufferAttribute,
      ),
    );

  const centerX = (box.min.x + box.max.x) / 2;
  const centerY = (box.min.y + box.max.y) / 2;
  textGeometry.translate(-centerX, -centerY, -box.min.z);
  baseGeometry.translate(-centerX, -centerY, -box.min.z);

  const size = box.getSize(new THREE.Vector3());
  assertSolid(textGeometry);
  assertSolid(baseGeometry);

  const warnings = [...profile.warnings];
  if (size.x > 140) {
    warnings.push("This is wide for a pocket keychain. Lower the letter height to shrink it.");
  }
  if (size.x < 35) {
    warnings.push("This is very small. Raise the letter height so the letters stay printable.");
  }

  return {
    text: textGeometry,
    base: baseGeometry,
    width: size.x,
    height: size.y,
    depth: safe.baseThickness + safe.textThickness,
    warnings,
  };
}

function getProfile(font: Font, params: KeychainParams, quality: MeshQuality) {
  const key = [
    font.names?.fontFamily?.en ?? font.unitsPerEm,
    params.text,
    params.letterHeight.toFixed(2),
    params.outline.toFixed(2),
    params.holeEnabled,
    params.holeDiameter.toFixed(2),
    params.holeSide,
    params.charm,
    quality,
  ].join("|");

  const cached = profileCache.get(key);
  if (cached) return cached;

  const settings = QUALITY[quality];
  const warnings: string[] = [];
  const missing = missingGlyphs(font, params.text);
  if (missing.length) {
    warnings.push(`This font has no glyph for ${missing.join(" ")}. Those characters were skipped.`);
  }

  const rings = textToRings(font, params.text, params.letterHeight, settings.maxCurveSteps);
  if (!rings.length) {
    throw new Error("That text has no printable outlines. Try letters or numbers.");
  }

  if (params.charm) {
    const bounds = ringBounds(rings);
    rings.push(
      ...pawRings(
        bounds.maxX,
        bounds.maxY,
        Math.max(8, bounds.maxY - bounds.minY),
        settings.circleSegments,
      ),
    );
  }

  const textPaths = clean(unionPaths(toClipper(rings)));
  if (!textPaths.length) {
    throw new Error("The letters could not be combined. Try a different font.");
  }

  let basePaths = offsetPaths(textPaths, params.outline, settings.arcTolerance);
  const textWidth = spanX(textPaths);
  if (spanX(basePaths) + 0.2 < textWidth) {
    basePaths = offsetPaths(reversePaths(textPaths), params.outline, settings.arcTolerance);
  }
  basePaths = clean(unionPaths(basePaths));
  if (!basePaths.length) {
    throw new Error("The outline collapsed. Increase the outline width slightly.");
  }

  if (params.holeEnabled) {
    const bounds = pathBounds(basePaths);
    const holeRadius = params.holeDiameter / 2;
    const wall = Math.max(1.8, params.outline * 0.6);
    const outerRadius = holeRadius + wall;
    const midY = (bounds.minY + bounds.maxY) / 2;
    const centerX =
      params.holeSide === "left"
        ? bounds.minX - holeRadius * 0.55
        : bounds.maxX + holeRadius * 0.55;
    const outer = circlePath(centerX, midY, outerRadius, settings.circleSegments);
    const inner = circlePath(centerX, midY, holeRadius, settings.circleSegments);
    const withTab = clean(unionPaths([...basePaths, outer]));
    const tree = difference(withTab, inner);
    const shapes = exPolygonsToShapes(tree);
    if (!shapes.holeCount) {
      warnings.push("The keyring hole did not cut through. Increase the hole or move it outward.");
    }
    const profile = {
      textShapes: pathsToShapes(textPaths),
      baseShapes: shapes.shapes,
      warnings,
    };
    remember(key, profile);
    return profile;
  }

  const profile = {
    textShapes: pathsToShapes(textPaths),
    baseShapes: pathsToShapes(basePaths),
    warnings,
  };
  remember(key, profile);
  return profile;
}

function remember(
  key: string,
  profile: { textShapes: THREE.Shape[]; baseShapes: THREE.Shape[]; warnings: string[] },
) {
  profileCache.set(key, profile);
  if (profileCache.size > 12) {
    const oldest = profileCache.keys().next().value;
    if (oldest) profileCache.delete(oldest);
  }
}

function missingGlyphs(font: Font, text: string) {
  const missing: string[] = [];
  for (const char of text) {
    if (char.trim() === "") continue;
    const glyph = font.charToGlyph(char);
    if (!glyph || glyph.index === 0 || glyph.name === ".notdef") missing.push(char);
  }
  return missing;
}

function textToRings(font: Font, text: string, letterHeight: number, maxCurveSteps: number) {
  const sample = font.charToGlyph("H");
  const capUnits = sample.yMax || font.ascender || font.unitsPerEm * 0.7;
  const fontSize = (letterHeight * font.unitsPerEm) / capUnits;
  const scale = fontSize / font.unitsPerEm;
  const commands: PathCommand[] = [];
  const chars = Array.from(text);
  let x = 0;

  for (let index = 0; index < chars.length; index += 1) {
    const glyph = font.charToGlyph(chars[index]);
    if (index > 0) {
      x += font.getKerningValue(font.charToGlyph(chars[index - 1]), glyph) * scale;
    }
    commands.push(...glyph.getPath(x, 0, fontSize, {}, font).commands);
    x += (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale;
  }

  return commandsToRings(commands, maxCurveSteps).filter((ring) => Math.abs(signedArea(ring)) > 0.12);
}

function commandsToRings(commands: PathCommand[], maxCurveSteps: number) {
  const rings: Ring[] = [];
  let ring: Ring = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const push = (x: number, y: number) => {
    const point = { x, y: -y };
    const prev = ring[ring.length - 1];
    if (!prev || Math.hypot(prev.x - point.x, prev.y - point.y) > 0.03) ring.push(point);
  };

  for (const command of commands) {
    if (command.type === "M") {
      if (ring.length >= 3) rings.push(ring);
      ring = [];
      cx = command.x;
      cy = command.y;
      sx = cx;
      sy = cy;
      push(cx, cy);
    } else if (command.type === "L") {
      cx = command.x;
      cy = command.y;
      push(cx, cy);
    } else if (command.type === "C") {
      const end = { x: command.x, y: command.y };
      const length =
        Math.hypot(command.x1 - cx, command.y1 - cy) +
        Math.hypot(command.x2 - command.x1, command.y2 - command.y1) +
        Math.hypot(end.x - command.x2, end.y - command.y2);
      const steps = Math.max(2, Math.min(maxCurveSteps, Math.ceil(length / 1.4)));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const point = cubic(
          { x: cx, y: cy },
          { x: command.x1, y: command.y1 },
          { x: command.x2, y: command.y2 },
          end,
          t,
        );
        push(point.x, point.y);
      }
      cx = end.x;
      cy = end.y;
    } else if (command.type === "Q") {
      const end = { x: command.x, y: command.y };
      const length =
        Math.hypot(command.x1 - cx, command.y1 - cy) + Math.hypot(end.x - command.x1, end.y - command.y1);
      const steps = Math.max(2, Math.min(maxCurveSteps, Math.ceil(length / 1.4)));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const point = quadratic({ x: cx, y: cy }, { x: command.x1, y: command.y1 }, end, t);
        push(point.x, point.y);
      }
      cx = end.x;
      cy = end.y;
    } else if (command.type === "Z") {
      if (ring.length >= 3) rings.push(ring);
      ring = [];
      cx = sx;
      cy = sy;
    }
  }

  if (ring.length >= 3) rings.push(ring);
  return rings;
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function quadratic(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function pawRings(maxX: number, maxY: number, letterHeight: number, segments: number) {
  const scale = letterHeight * 0.62;
  const padR = scale * 0.34;
  const toeR = scale * 0.16;
  const cx = maxX - padR * 0.15;
  const cy = maxY - padR * 0.05;
  return [
    circleRing(cx, cy - padR * 0.15, padR, segments),
    circleRing(cx - toeR * 1.35, cy + padR * 0.85, toeR, segments),
    circleRing(cx, cy + padR * 1.15, toeR * 0.95, segments),
    circleRing(cx + toeR * 1.35, cy + padR * 0.85, toeR, segments),
  ];
}

function circleRing(cx: number, cy: number, radius: number, segments: number): Ring {
  const ring: Ring = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return ring;
}

function circlePath(cx: number, cy: number, radius: number, segments: number) {
  return toClipper([circleRing(cx, cy, radius, segments)])[0];
}

function toClipper(rings: Ring[], scale = SCALE): Paths {
  return rings
    .map((ring) =>
      ring.map((point) => ({
        X: Math.round(point.x * scale),
        Y: Math.round(point.y * scale),
      })),
    )
    .filter((path) => path.length >= 3);
}

function unionPaths(paths: Paths) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  if (!ok) throw new Error("The letter outlines overlapped in a way that could not be repaired.");
  return ClipperLib.Clipper.PolyTreeToPaths(tree);
}

function difference(subject: Paths, clip: Path) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(clip, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  if (!ok) throw new Error("The keyring hole could not be cut.");
  return tree;
}

function offsetPaths(paths: Paths, deltaMm: number, arcToleranceMm: number) {
  const offset = new ClipperLib.ClipperOffset(2, arcToleranceMm * SCALE);
  offset.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, deltaMm * SCALE);
  return solution;
}

function clean(paths: Paths, distanceMm = 0.02, scale = SCALE) {
  if (!paths.length) return paths;
  return ClipperLib.Clipper.CleanPolygons(paths, distanceMm * scale);
}

function reversePaths(paths: Paths) {
  return paths.map((path) => [...path].reverse());
}

function pathsToShapes(paths: Paths, scale = SCALE) {
  const shapes = exPolygonsToShapes(pathsToTree(paths), scale).shapes;
  if (!shapes.length) throw new Error("The keychain outline was empty.");
  return shapes;
}

function pathsToTree(paths: Paths) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return tree;
}

function exPolygonsToShapes(tree: PolyTree, scale = SCALE) {
  const polygons = ClipperLib.JS.PolyTreeToExPolygons(tree);
  const shapes: THREE.Shape[] = [];
  let holeCount = 0;
  for (const polygon of polygons) {
    if (polygon.outer.length < 3) continue;
    const shape = new THREE.Shape(toVectors(polygon.outer, scale));
    for (const hole of polygon.holes) {
      if (hole.length < 3) continue;
      const area = Math.abs(pathArea(hole)) / (scale * scale);
      if (area < 0.4) continue;
      shape.holes.push(new THREE.Path(toVectors(hole, scale)));
      holeCount += 1;
    }
    shapes.push(shape);
  }
  if (!shapes.length) throw new Error("The keychain outline was empty.");
  return { shapes, holeCount };
}

function toVectors(path: Path, scale = SCALE) {
  return path.map((point) => new THREE.Vector2(point.X / scale, point.Y / scale));
}

function extrude(shapes: THREE.Shape[], depth: number, curveSegments = 1) {
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments,
    steps: 1,
  });
  geometry.computeBoundingBox();
  return geometry;
}

export function extrudeShapes(shapes: THREE.Shape[], depth: number, curveSegments = 8) {
  if (!(depth > 0)) throw new Error("Thickness has to be greater than zero.");
  return extrude(shapes, depth, curveSegments);
}

export function cutShapes(subject: THREE.Shape[], cuts: THREE.Shape[], divisions = 96) {
  const scale = 100000;
  const rings = (shape: THREE.Shape) => shapeRings(shape, divisions);
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(toClipper(subject.flatMap(rings), scale), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(toClipper(cuts.flatMap(rings), scale), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  if (!ok) throw new Error("The recessed detail could not be cut.");
  return pathsToShapes(clean(ClipperLib.Clipper.PolyTreeToPaths(tree), 0.0002, scale), scale);
}

function shapeRings(shape: THREE.Shape, divisions: number) {
  const outer = shape.getPoints(divisions).map((point) => ({ x: point.x, y: point.y }));
  if (signedArea(outer) < 0) outer.reverse();
  const holes = shape.holes.map((hole) => {
    const ring = hole.getPoints(divisions).map((point) => ({ x: point.x, y: point.y }));
    if (signedArea(ring) > 0) ring.reverse();
    return ring;
  });
  return [outer, ...holes];
}

export type GlyphLayout = {
  char: string;
  shapes: THREE.Shape[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function layoutText(
  font: Font,
  raw: string,
  letterHeight: number,
  quality: MeshQuality,
  options?: { tracking?: number; maxChars?: number },
) {
  const text = raw.normalize("NFC").slice(0, options?.maxChars ?? MAX_CHARS);
  if (!text.trim()) throw new Error("Type a name to generate this model.");
  const settings = QUALITY[quality];
  const warnings: string[] = [];
  const missing = missingGlyphs(font, text);
  if (missing.length) {
    warnings.push(`This font has no glyph for ${missing.join(" ")}. Those characters were skipped.`);
  }

  const sample = font.charToGlyph("H");
  const capUnits = sample.yMax || font.ascender || font.unitsPerEm * 0.7;
  const fontSize = (letterHeight * font.unitsPerEm) / capUnits;
  const scale = fontSize / font.unitsPerEm;
  const tracking = options?.tracking ?? 0;
  const glyphs: GlyphLayout[] = [];
  const chars = Array.from(text);
  let x = 0;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const glyph = font.charToGlyph(char);
    if (index > 0) x += font.getKerningValue(font.charToGlyph(chars[index - 1]), glyph) * scale;
    if (char.trim()) {
      const commands = glyph.getPath(x, 0, fontSize, {}, font).commands;
      const rings = commandsToRings(commands, settings.maxCurveSteps).filter(
        (ring) => Math.abs(signedArea(ring)) > 0.12,
      );
      if (rings.length) {
        const paths = clean(unionPaths(toClipper(rings)));
        if (paths.length) {
          const shapes = pathsToShapes(paths);
          const bounds = ringBounds(rings);
          glyphs.push({ char, shapes, ...bounds });
        }
      }
    }
    x += (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale + tracking;
  }

  if (!glyphs.length) throw new Error("That text has no printable outlines. Try letters or numbers.");
  return { shapes: glyphs.flatMap((glyph) => glyph.shapes), glyphs, warnings };
}

function assertSolid(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 12) {
    throw new Error("The keychain mesh was too small to print.");
  }
  for (let index = 0; index < position.count; index += 1) {
    if (
      !Number.isFinite(position.getX(index)) ||
      !Number.isFinite(position.getY(index)) ||
      !Number.isFinite(position.getZ(index))
    ) {
      throw new Error("The keychain shape broke. Try a different font or a shorter name.");
    }
  }
}

function ringBounds(rings: Ring[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function pathBounds(paths: Paths) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (const point of path) {
      const x = point.X / SCALE;
      const y = point.Y / SCALE;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function spanX(paths: Paths) {
  const bounds = pathBounds(paths);
  return bounds.maxX - bounds.minX;
}

function pathArea(path: Path) {
  let area = 0;
  for (let index = 0; index < path.length; index += 1) {
    const next = path[(index + 1) % path.length];
    area += path[index].X * next.Y - next.X * path[index].Y;
  }
  return area / 2;
}

function signedArea(ring: Ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const next = ring[(index + 1) % ring.length];
    area += ring[index].x * next.y - next.x * ring[index].y;
  }
  return area / 2;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
