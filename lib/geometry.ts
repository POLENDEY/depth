import ClipperLib from "clipper-lib";
import type { Path, Paths, PolyTree } from "clipper-lib";
import type { Font, PathCommand } from "opentype.js";
import * as THREE from "three";
import { charmLayers, charmRings, isEmojiCharm } from "./charms";

export type HoleSide = "left" | "right";
export type MeshQuality = "preview" | "print";

export type CharmPlacement = {
  id: string;
  x: number;
  y: number;
  size: number;
};

export type CharmBox = { minX: number; minY: number; maxX: number; maxY: number };

export type KeychainParams = {
  text: string;
  letterHeight: number;
  outline: number;
  holeEnabled: boolean;
  holeDiameter: number;
  holeSide: HoleSide;
  baseThickness: number;
  textThickness: number;
  charms: CharmPlacement[];
  charmBase: number;
  holeOffsetX: number;
  holeOffsetY: number;
};

export type KeychainModel = {
  text: THREE.BufferGeometry;
  base: THREE.BufferGeometry;
  width: number;
  height: number;
  depth: number;
  warnings: string[];
  charmBounds: CharmBox[];
  hole: { x: number; y: number; radius: number } | null;
};

type Point = { x: number; y: number };
type Ring = Point[];

const SCALE = 1000;
const FUSE = 0.15;
const MAX_CHARS = 18;
export const MAX_CHARMS = 8;

export const LIMITS = {
  letterHeight: [8, 50] as const,
  outline: [0.8, 6] as const,
  holeDiameter: [3, 8] as const,
  baseThickness: [0.8, 6] as const,
  textThickness: [0.4, 4] as const,
  charmSize: [8, 64] as const,
  charmBase: [0, 4] as const,
  charmOffsetX: [-160, 240] as const,
  charmOffsetY: [-80, 80] as const,
  holeOffsetX: [-120, 120] as const,
  holeOffsetY: [-80, 80] as const,
  characters: MAX_CHARS,
};

const QUALITY = {
  preview: { maxCurveSteps: 8, circleSegments: 36, arcTolerance: 0.1 },
  print: { maxCurveSteps: 12, circleSegments: 56, arcTolerance: 0.06 },
} as const;

const profileCache = new Map<string, Profile>();

type Profile = {
  textShapes: THREE.Shape[];
  baseShapes: THREE.Shape[];
  warnings: string[];
  charmBounds: CharmBox[];
  hole: { x: number; y: number; radius: number } | null;
  centerX: number;
  centerY: number;
};

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
    charms: sanitizeCharms(params.charms, params.letterHeight * 1.42),
    charmBase: clamp(
      Number.isFinite(params.charmBase) ? params.charmBase : 1.2,
      LIMITS.charmBase[0],
      LIMITS.charmBase[1],
    ),
    holeOffsetX: clamp(
      Number.isFinite(params.holeOffsetX) ? params.holeOffsetX : 0,
      LIMITS.holeOffsetX[0],
      LIMITS.holeOffsetX[1],
    ),
    holeOffsetY: clamp(
      Number.isFinite(params.holeOffsetY) ? params.holeOffsetY : 0,
      LIMITS.holeOffsetY[0],
      LIMITS.holeOffsetY[1],
    ),
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

  const centerX = profile.centerX;
  const centerY = profile.centerY;
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

  const charmBounds = shiftBoxes(profile.charmBounds, centerX, centerY);
  const hole = profile.hole
    ? { x: profile.hole.x - centerX, y: profile.hole.y - centerY, radius: profile.hole.radius }
    : null;

  return {
    text: textGeometry,
    base: baseGeometry,
    width: size.x,
    height: size.y,
    depth: safe.baseThickness + safe.textThickness,
    warnings,
    charmBounds,
    hole,
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
    JSON.stringify(params.charms),
    params.charmBase.toFixed(2),
    params.holeOffsetX.toFixed(2),
    params.holeOffsetY.toFixed(2),
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
  const letters = ringBounds(rings);
  const centerX = (letters.minX + letters.maxX) / 2;
  const centerY = (letters.minY + letters.maxY) / 2;

  const charmPiece = appendCharms(params.charms, letters.maxX, centerY, params.outline, params.charmBase);
  const charmBounds = charmPiece.bounds;
  const charmPaths = charmPiece.text;

  const letterPaths = clean(unionPaths(toClipper(rings)));
  if (!letterPaths.length) {
    throw new Error("The letters could not be combined. Try a different font.");
  }
  const textPaths = charmPaths.length ? clean(unionPaths([...letterPaths, ...charmPaths])) : letterPaths;

  let basePaths = offsetPaths(letterPaths, params.outline, settings.arcTolerance);
  if (spanX(basePaths) + 0.2 < spanX(letterPaths)) {
    basePaths = offsetPaths(reversePaths(letterPaths), params.outline, settings.arcTolerance);
  }
  const letterBox = pathBounds(basePaths);
  if (charmPiece.base.length) basePaths = [...basePaths, ...charmPiece.base];
  basePaths = clean(unionPaths(basePaths));
  if (!basePaths.length) {
    throw new Error("The outline collapsed. Increase the outline width slightly.");
  }

  const eyeballs = eyeBaseShapes(charmPiece.eyes);
  const textShapes = punchedTextShapes(textPaths, charmPiece.eyes);
  const holeSpot = params.holeEnabled ? placeHole(letterBox, params, settings.circleSegments) : null;
  if (holeSpot) {
    const withTab = clean(unionPaths([...basePaths, holeSpot.outer]));
    const tree = difference(withTab, holeSpot.inner);
    const shapes = exPolygonsToShapes(tree);
    if (!shapes.holeCount) {
      warnings.push("The keyring hole did not cut through. Increase the hole or move it outward.");
    }
    const profile = {
      textShapes,
      baseShapes: [...shapes.shapes, ...eyeballs],
      warnings,
      charmBounds,
      hole: { x: holeSpot.x, y: holeSpot.y, radius: holeSpot.radius },
      centerX,
      centerY,
    };
    remember(key, profile);
    return profile;
  }

  const profile = {
    textShapes,
    baseShapes: [...pathsToShapes(basePaths), ...eyeballs],
    warnings,
    charmBounds,
    hole: null,
    centerX,
    centerY,
  };
  remember(key, profile);
  return profile;
}

function boundsOfRings(rings: Ring[]) {
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
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function remember(key: string, profile: Profile) {
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

function textToRings(font: Font, text: string, letterHeight: number, maxCurveSteps: number, stepMm = 1.4) {
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

  return commandsToRings(commands, maxCurveSteps, stepMm).filter((ring) => Math.abs(signedArea(ring)) > 0.12);
}

function commandsToRings(commands: PathCommand[], maxCurveSteps: number, stepMm = 1.4) {
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
      const steps = Math.max(stepMm < 1 ? 6 : 2, Math.min(maxCurveSteps, Math.ceil(length / stepMm)));
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
      const steps = Math.max(stepMm < 1 ? 6 : 2, Math.min(maxCurveSteps, Math.ceil(length / stepMm)));
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

function circleRing(cx: number, cy: number, radius: number, segments: number): Ring {
  const ring: Ring = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return ring;
}

function bridgeRimBlobs(
  parts: { points: { x: number; y: number }[]; hole?: boolean }[],
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
) {
  const spanOf = (points: { x: number; y: number }[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return Math.max(maxX - minX, maxY - minY);
  };
  const blobs = parts.filter((part) => {
    let sx = 0;
    let sy = 0;
    for (const point of part.points) {
      sx += point.x;
      sy += point.y;
    }
    const px = sx / part.points.length;
    const py = sy / part.points.length;
    const radius = Math.hypot(px - cx, py - cy);
    return radius > rOuter * 0.98 && radius < rOuter * 1.45 && spanOf(part.points) < rOuter * 0.7;
  });
  if (blobs.length < 2) return parts;
  const clusters: { points: { x: number; y: number }[] }[][] = [];
  for (const blob of blobs) {
    let sx = 0;
    let sy = 0;
    for (const point of blob.points) {
      sx += point.x;
      sy += point.y;
    }
    const angle = Math.atan2(sy / blob.points.length - cy, sx / blob.points.length - cx);
    const cluster = clusters.find((group) => {
      let gx = 0;
      let gy = 0;
      let count = 0;
      for (const part of group) {
        for (const point of part.points) {
          gx += point.x;
          gy += point.y;
          count += 1;
        }
      }
      const groupAngle = Math.atan2(gy / count - cy, gx / count - cx);
      const delta = Math.abs(Math.atan2(Math.sin(angle - groupAngle), Math.cos(angle - groupAngle)));
      return delta < 0.6;
    });
    if (cluster) cluster.push(blob);
    else clusters.push([blob]);
  }
  const solids = clusters.map((cluster) => {
    const points = cluster.flatMap((part) => part.points);
    let sx = 0;
    let sy = 0;
    for (const point of points) {
      sx += point.x;
      sy += point.y;
    }
    const angle = Math.atan2(sy / points.length - cy, sx / points.length - cx);
    for (const turn of [-0.4, -0.15, 0, 0.15, 0.4]) {
      points.push({ x: cx + Math.cos(angle + turn) * rInner * 0.55, y: cy + Math.sin(angle + turn) * rInner * 0.55 });
      points.push({ x: cx + Math.cos(angle + turn) * rOuter, y: cy + Math.sin(angle + turn) * rOuter });
    }
    const hull = convexHull(points.map((point) => ({ X: Math.round(point.x * 1000), Y: Math.round(point.y * 1000) }))).map(
      (point) => ({ x: point.X / 1000, y: point.Y / 1000 }),
    );
    let area = 0;
    for (let index = 0; index < hull.length; index += 1) {
      const next = hull[(index + 1) % hull.length];
      area += hull[index].x * next.y - next.x * hull[index].y;
    }
    return { points: area < 0 ? hull.reverse() : hull };
  });
  return [...parts.filter((part) => !blobs.includes(part)), ...solids];
}

function closeSplitFace(
  parts: { points: { x: number; y: number }[]; hole?: boolean }[],
): { points: { x: number; y: number }[]; hole?: boolean }[] {
  const measured = parts.map((part) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of part.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { part, span: Math.max(maxX - minX, maxY - minY), minX, minY, maxX, maxY };
  });
  const maxSpan = measured.reduce((span, entry) => Math.max(span, entry.span), 0);
  const large = measured.filter((entry) => entry.span >= maxSpan * 0.62);
  if (large.length < 2 || maxSpan <= 0) return parts;
  const points = large.flatMap((entry) => entry.part.points);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const distances = points.map((point) => Math.hypot(point.x - cx, point.y - cy)).sort((a, b) => a - b);
  const rInner = distances[Math.floor(distances.length * 0.12)] ?? 0;
  const rOuter = distances[Math.floor(distances.length * 0.88)] ?? 0;
  if (rOuter < maxSpan * 0.35 || rOuter - rInner > rOuter * 0.28) return parts;
  const bins = new Array<boolean>(36).fill(false);
  for (const point of points) {
    const angle = Math.atan2(point.y - cy, point.x - cx);
    bins[Math.floor(((angle + Math.PI) / (Math.PI * 2)) * bins.length) % bins.length] = true;
  }
  if (bins.filter(Boolean).length / bins.length < 0.55) return parts;
  const ringCoverage = (ring: { x: number; y: number }[]) => {
    const ringBins = new Array<boolean>(36).fill(false);
    for (const point of ring) {
      const angle = Math.atan2(point.y - cy, point.x - cx);
      ringBins[Math.floor(((angle + Math.PI) / (Math.PI * 2)) * ringBins.length) % ringBins.length] = true;
    }
    return ringBins.filter(Boolean).length / ringBins.length;
  };
  if (large.some((entry) => ringCoverage(entry.part.points) > 0.75)) return parts;
  const arcs = large.filter((entry) => {
    const onRim = entry.part.points.filter((point) => {
      const radius = Math.hypot(point.x - cx, point.y - cy);
      return radius > rInner * 0.9 && radius < rOuter * 1.08;
    }).length;
    return onRim / entry.part.points.length > 0.55;
  });
  if (arcs.length < 2) return parts;
  const kept = bridgeRimBlobs(
    parts.filter((part) => !arcs.some((arc) => arc.part === part)),
    cx,
    cy,
    rInner,
    rOuter,
  );
  const mouth = kept.flatMap((part) => {
    const inside = part.points.filter((point) => point.y < cy && Math.hypot(point.x - cx, point.y - cy) < rOuter);
    return inside.length / part.points.length > 0.6 ? part.points : [];
  });
  const filled =
    mouth.length >= 3
      ? [
          {
            points: convexHull(mouth.map((point) => ({ X: Math.round(point.x * 1000), Y: Math.round(point.y * 1000) }))).map(
              (point) => ({ x: point.X / 1000, y: point.Y / 1000 }),
            ),
          },
        ]
      : [];
  return [
    ...kept,
    ...filled,
    { points: circleRing(cx, cy, rOuter, 96) },
    { points: circleRing(cx, cy, rInner, 96).reverse(), hole: true },
  ];
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

function differencePaths(subject: Paths, clips: Paths) {
  const clipper = new ClipperLib.Clipper(0);
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(clips, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  if (!ok) return pathsToTree(subject);
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

export function withCharm(charms: CharmPlacement[], id: string, fallbackSize: number) {
  const list = sanitizeCharms(charms, fallbackSize);
  if (!id || list.length >= MAX_CHARMS) return list;
  const size = list.at(-1)?.size ?? clamp(fallbackSize, LIMITS.charmSize[0], LIMITS.charmSize[1]);
  const x = list.reduce((sum, charm) => sum + charm.size * 1.2, 0);
  return sanitizeCharms([...list, { id, x, y: 0, size }], fallbackSize);
}

function sanitizeCharms(charms: CharmPlacement[] | undefined, fallbackSize: number) {
  return (charms ?? [])
    .filter((charm) => charm && typeof charm.id === "string" && charm.id)
    .slice(0, MAX_CHARMS)
    .map((charm) => ({
      id: charm.id,
      x: clamp(Number(charm.x), LIMITS.charmOffsetX[0], LIMITS.charmOffsetX[1]),
      y: clamp(Number(charm.y), LIMITS.charmOffsetY[0], LIMITS.charmOffsetY[1]),
      size: clamp(
        Number.isFinite(Number(charm.size)) ? Number(charm.size) : fallbackSize,
        LIMITS.charmSize[0],
        LIMITS.charmSize[1],
      ),
    }));
}

function shiftBoxes(boxes: CharmBox[], centerX: number, centerY: number) {
  return boxes.map((box) => ({
    minX: box.minX - centerX,
    minY: box.minY - centerY,
    maxX: box.maxX - centerX,
    maxY: box.maxY - centerY,
  }));
}

function iconBase(bodyPaths: Paths, markPaths: Paths, margin: number) {
  const footprint =
    bodyPaths.length && markPaths.length
      ? clean(unionPaths([...bodyPaths, ...markPaths]), 0.004)
      : bodyPaths.length
        ? bodyPaths
        : markPaths;
  const pad = margin > 0.05 ? margin : bodyPaths.length ? 0 : 0.9;
  if (pad <= 0.05 || !footprint.length) return bodyPaths;
  let rim = offsetPaths(footprint, pad, 0.02);
  if (!rim.length || spanX(rim) + 0.2 < spanX(footprint)) rim = offsetPaths(reversePaths(footprint), pad, 0.02);
  if (!rim.length) return bodyPaths.length ? bodyPaths : footprint;
  if (!bodyPaths.length) return rim;
  const fused = clean(unionPaths([...bodyPaths, ...rim]), 0.008);
  return fused.length ? fused : bodyPaths;
}

function appendCharms(
  charms: CharmPlacement[],
  anchorX: number,
  anchorY: number,
  outline: number,
  charmBase: number,
) {
  const texts: Paths = [];
  const bases: Paths = [];
  const eyes: EyeBall[] = [];
  const bounds: CharmBox[] = [];
  for (const charm of charms) {
    const piece = appendCharm(charm.id, charm.x, charm.y, charm.size, anchorX, anchorY, outline, charmBase);
    texts.push(...piece.text);
    bases.push(...piece.base);
    eyes.push(...piece.eyes);
    bounds.push(
      piece.bounds ?? {
        minX: anchorX + charm.x,
        minY: anchorY + charm.y,
        maxX: anchorX + charm.x,
        maxY: anchorY + charm.y,
      },
    );
  }
  return {
    text: texts.length ? clean(unionPaths(texts), 0.004) : ([] as Paths),
    base: bases.length ? clean(unionPaths(bases), 0.004) : ([] as Paths),
    bounds,
    eyes,
  };
}

function appendCharm(
  charm: string,
  offsetX: number,
  offsetY: number,
  size: number,
  anchorX: number,
  anchorY: number,
  outline: number,
  charmBase: number,
) {
  if (!charm) return { text: [] as Paths, base: [] as Paths, bounds: null as CharmBox | null, eyes: [] as EyeBall[] };
  const originX = anchorX + size * 0.24 + offsetX;
  const originY = anchorY + offsetY;
  const layers = charmLayers(charm, originX, originY, size);
  if (layers) {
    const bounds = boundsOfRings([...layers.body, ...layers.mark].map((ring) => ring.points));
    const markSource = toClipper(layers.mark.map((ring) => ring.points));
    const bodySource = toClipper(layers.body.map((ring) => ring.points));
    const markPaths = markSource.length ? clean(unionPaths(markSource), 0.004) : [];
    let bodyPaths = bodySource.length ? clean(unionPaths(bodySource), 0.004) : [];
    const pupils = toClipper(layers.pupil.map((ring) => ring.points)).map((path) => asOuter(path));
    bodyPaths = iconBase(bodyPaths, markPaths, charmBase);
    return {
      text: markPaths,
      base: bodyPaths,
      bounds,
      eyes: pupils.map((pupil) => ({ sclera: pupil, pupil, fill: false })),
    };
  }
  const placed = closeSplitFace(charmRings(charm, originX, originY, size, 48));
  const bounds = boundsOfRings(placed.filter((part) => !part.hole).map((part) => part.points));
  if (!placed.length) return { text: [] as Paths, base: [] as Paths, bounds, eyes: [] as EyeBall[] };
  const charmArc = 0.012;
  let charmPaths = clean(unionPaths(toClipper(placed.map((part) => part.points))), 0.004);
  const welded = offsetPaths(charmPaths, 0.04, charmArc);
  if (spanX(welded) + 0.2 >= spanX(charmPaths)) charmPaths = clean(welded, 0.004);
  let plate: Paths = [];
  let eyes: EyeBall[] = [];
  if (isEmojiCharm(charm)) {
    const sealed = sealEmoji(charmPaths);
    charmPaths = sealed.features;
    plate = sealed.plate;
    eyes = sealed.eyes;
  } else {
    plate = fillObject(charmPaths);
  }
  const charmOutline = Math.max(1.05, outline * 0.55);
  let charmRim = offsetPaths(charmPaths, charmOutline, charmArc);
  if (spanX(charmRim) + 0.2 < spanX(charmPaths)) {
    charmRim = offsetPaths(reversePaths(charmPaths), charmOutline, charmArc);
  }
  return { text: charmPaths, base: [...charmRim, ...plate], bounds, eyes };
}

function placeHole(
  letterBox: { minX: number; minY: number; maxX: number; maxY: number },
  params: KeychainParams,
  segments: number,
) {
  const holeRadius = params.holeDiameter / 2;
  const wall = Math.max(1.8, params.outline * 0.6);
  const outerRadius = holeRadius + wall;
  const anchorX =
    params.holeSide === "left" ? letterBox.minX - holeRadius * 0.55 : letterBox.maxX + holeRadius * 0.55;
  const anchorY = (letterBox.minY + letterBox.maxY) / 2;
  const x = anchorX + params.holeOffsetX;
  const y = anchorY + params.holeOffsetY;
  return {
    x,
    y,
    radius: outerRadius,
    outer: circlePath(x, y, outerRadius, segments),
    inner: circlePath(x, y, holeRadius, segments),
  };
}

type FacePolygon = { outer: Path; holes: Path[] };

function repairSplitFace(polygons: FacePolygon[], maxSpan: number) {
  const large = polygons.filter((polygon) => radialStats(polygon.outer).span >= maxSpan * 0.62);
  if (large.length < 2) return null;
  const points = large.flatMap((polygon) => polygon.outer);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.X);
    minY = Math.min(minY, point.Y);
    maxX = Math.max(maxX, point.X);
    maxY = Math.max(maxY, point.Y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const distances = points.map((point) => Math.hypot(point.X - cx, point.Y - cy)).sort((a, b) => a - b);
  const rInner = distances[Math.floor(distances.length * 0.12)] ?? 0;
  const rOuter = distances[Math.floor(distances.length * 0.88)] ?? 0;
  if (rOuter < maxSpan * 0.35 || rOuter - rInner > rOuter * 0.28) return null;
  const bins = new Array<boolean>(36).fill(false);
  for (const point of points) {
    const angle = Math.atan2(point.Y - cy, point.X - cx);
    bins[Math.floor(((angle + Math.PI) / (Math.PI * 2)) * bins.length) % bins.length] = true;
  }
  if (bins.filter(Boolean).length / bins.length < 0.55) return null;
  const arcs = large.filter((polygon) => {
    const onRim = polygon.outer.filter((point) => {
      const radius = Math.hypot(point.X - cx, point.Y - cy);
      return radius > rInner * 0.9 && radius < rOuter * 1.08;
    }).length;
    return onRim / polygon.outer.length > 0.55;
  });
  if (arcs.length < 2) return null;
  return { arcs, cx, cy, rInner, rOuter };
}

function convexHull(points: Path) {
  const sorted = [...points].sort((a, b) => a.X - b.X || a.Y - b.Y);
  const cross = (origin: { X: number; Y: number }, a: { X: number; Y: number }, b: { X: number; Y: number }) =>
    (a.X - origin.X) * (b.Y - origin.Y) - (a.Y - origin.Y) * (b.X - origin.X);
  const build = (source: Path) => {
    const hull: Path = [];
    for (const point of source) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull;
  };
  const lower = build(sorted);
  const upper = build(sorted.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonPaths(polygon: FacePolygon, solidHolesInside?: { cx: number; cy: number; radius: number }) {
  const paths: Paths = [asOuter(polygon.outer)];
  for (const hole of polygon.holes) {
    const stats = radialStats(hole);
    const inside =
      solidHolesInside &&
      Math.hypot(stats.cx - solidHolesInside.cx, stats.cy - solidHolesInside.cy) < solidHolesInside.radius * 0.96;
    if (inside) paths.push(asOuter(hole));
    else paths.push(pathArea(hole) > 0 ? [...hole].reverse() : hole.slice());
  }
  return paths;
}

function pupilDisks(polygons: FacePolygon[], maxSpan: number) {
  const skip = new Set<FacePolygon>();
  for (const polygon of polygons) {
    const outer = radialStats(polygon.outer);
    if (outer.span >= maxSpan * 0.16 || outer.span <= maxSpan * 0.035) continue;
    const hull = convexHull(polygon.outer);
    if (hull.length < 3) continue;
    const disk = Math.PI * (outer.span / 2) ** 2;
    if (Math.abs(pathArea(hull)) <= disk * 0.55) continue;
    skip.add(polygon);
  }
  if (!skip.size) return null;
  const kept: Paths = [];
  for (const polygon of polygons) {
    if (skip.has(polygon)) continue;
    kept.push(...polygonPaths(polygon));
  }
  return kept.length ? clean(unionPaths(kept), 0.004) : null;
}

type EyeBall = { sclera: Path; pupil: Path; fill?: boolean };

function eyeBalls(polygons: FacePolygon[], maxSpan: number) {
  const eyes: EyeBall[] = [];
  for (const polygon of polygons) {
    for (const hole of polygon.holes) {
      const stats = radialStats(hole);
      const ratio = stats.span / maxSpan;
      if (ratio < 0.14 || ratio > 0.3) continue;
      const disk = Math.PI * (stats.span / 2) ** 2;
      if (Math.abs(pathArea(hole)) < disk * 0.55) continue;
      const radius = Math.max((stats.span / SCALE) * 0.24, 0.9);
      eyes.push({
        sclera: asOuter(hole),
        pupil: asOuter(circlePath(stats.cx / SCALE, stats.cy / SCALE, radius, 48)),
      });
    }
  }
  return eyes;
}

function fillObject(paths: Paths) {
  const polygons = ClipperLib.JS.PolyTreeToExPolygons(pathsToTree(paths)) as FacePolygon[];
  let maxSpan = 0;
  for (const polygon of polygons) maxSpan = Math.max(maxSpan, radialStats(polygon.outer).span);
  if (maxSpan <= 0) return [] as Paths;
  const plates: Paths = [];
  for (const polygon of polygons) {
    const stats = radialStats(polygon.outer);
    if (stats.span >= maxSpan * 0.22) {
      const area = Math.abs(pathArea(polygon.outer));
      if (area <= stats.span * stats.span * 0.55) {
        const hull = convexHull(polygon.outer);
        if (hull.length >= 3) plates.push(asOuter(hull));
      }
    }
    for (const hole of polygon.holes) {
      const holeStats = radialStats(hole);
      if (holeStats.span < maxSpan * 0.12 || holeStats.span > maxSpan * 0.62) continue;
      plates.push(asOuter(hole));
    }
  }
  return plates.length ? clean(unionPaths(plates), 0.004) : [];
}

function sealEmoji(paths: Paths) {
  const polygons = ClipperLib.JS.PolyTreeToExPolygons(pathsToTree(paths)) as FacePolygon[];
  let maxSpan = 0;
  for (const polygon of polygons) maxSpan = Math.max(maxSpan, radialStats(polygon.outer).span);
  if (maxSpan <= 0) return { features: paths, plate: [] as Paths, eyes: [] as EyeBall[] };
  const eyes = eyeBalls(polygons, maxSpan);

  let minY = Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    const stats = radialStats(polygon.outer);
    minY = Math.min(minY, stats.minY);
    maxY = Math.max(maxY, stats.maxY);
  }
  const midY = (minY + maxY) / 2;

  let ring: Path | null = null;
  let faceStats: ReturnType<typeof radialStats> | null = null;
  for (const polygon of polygons) {
    const stats = radialStats(polygon.outer);
    if (stats.span < maxSpan * 0.72) continue;
    if (faceStats && stats.span < faceStats.span) continue;
    const disk = Math.PI * (stats.span / 2) ** 2;
    if (Math.abs(pathArea(polygon.outer)) > disk * 0.2) continue;
    ring = polygon.outer;
    faceStats = stats;
  }

  let faceHole: Path | null = null;
  let plate: Paths = [];
  if (ring && faceStats) {
    const spot = inscribed(ring);
    plate = [circlePath(spot.x / SCALE, spot.y / SCALE, spot.distance / SCALE + 0.28, 96)];
    faceStats = { ...faceStats, cx: spot.x, cy: spot.y };
  } else {
    const split = repairSplitFace(polygons, maxSpan);
    if (split) {
      const kept: Paths = [];
      for (const polygon of polygons) {
        if (split.arcs.includes(polygon)) continue;
        kept.push(...polygonPaths(polygon, { cx: split.cx, cy: split.cy, radius: split.rInner }));
      }
      const mouth: Path = [];
      for (const polygon of polygons) {
        if (split.arcs.includes(polygon)) continue;
        const stats = radialStats(polygon.outer);
        const fromCenter = Math.hypot(stats.cx - split.cx, stats.cy - split.cy);
        if (fromCenter < split.rInner * 0.72 && stats.cy < split.cy) mouth.push(...polygon.outer);
      }
      if (mouth.length >= 3) kept.push(asOuter(convexHull(mouth)));
      const outline = circlePath(split.cx / SCALE, split.cy / SCALE, split.rOuter / SCALE, 96);
      const opening = circlePath(split.cx / SCALE, split.cy / SCALE, split.rInner / SCALE, 96);
      kept.push(asOuter(outline), pathArea(opening) > 0 ? [...opening].reverse() : opening);
      const plateDisk = circlePath(split.cx / SCALE, split.cy / SCALE, split.rInner / SCALE + 0.35, 96);
      return { features: clean(unionPaths(kept), 0.004), plate: [asOuter(plateDisk)], eyes };
    }
    for (const polygon of polygons) {
      for (const hole of polygon.holes) {
        const stats = radialStats(hole);
        if (stats.span < maxSpan * 0.45 || Math.abs(stats.cy - midY) > maxSpan * 0.35) continue;
        if (!faceStats || stats.span > faceStats.span) {
          faceHole = hole;
          faceStats = stats;
        }
      }
    }
    if (faceHole) {
      const outer = asOuter(faceHole);
      const grown = offsetPaths([outer], 0.22, 0.012);
      plate = spanX(grown) + 0.2 >= spanX([outer]) ? grown : [outer];
    }
  }
  const withPupils = pupilDisks(polygons, maxSpan) ?? paths;
  if (!faceStats || !plate.length) return { features: withPupils, plate: [] as Paths, eyes };

  const eyePaths: Path[] = [];
  for (const polygon of polygons) {
    const parent = radialStats(polygon.outer);
    const outside = Math.hypot(parent.cx - faceStats.cx, parent.cy - faceStats.cy) > faceStats.span * 0.55;
    for (const hole of polygon.holes) {
      if (hole === faceHole) continue;
      const stats = radialStats(hole);
      if (Math.abs(pathArea(hole)) / (SCALE * SCALE) < 0.35) continue;
      const eyeSized = stats.span < faceStats.span * 0.2;
      if (!eyeSized && stats.span > faceStats.span * 0.4) continue;
      if (!eyeSized && stats.cy <= faceStats.cy && !outside) continue;
      eyePaths.push(asOuter(hole));
    }
  }

  const features = eyePaths.length ? clean(unionPaths([...withPupils, ...eyePaths]), 0.004) : withPupils;
  return { features, plate, eyes };
}

function inscribed(path: Path) {
  const bounds = radialStats(path);
  let bestX = bounds.cx;
  let bestY = bounds.cy;
  let best = 0;
  const steps = 22;
  for (let iy = 0; iy <= steps; iy += 1) {
    for (let ix = 0; ix <= steps; ix += 1) {
      const x = bounds.minX + ((bounds.maxX - bounds.minX) * ix) / steps;
      const y = bounds.minY + ((bounds.maxY - bounds.minY) * iy) / steps;
      let nearest = Infinity;
      for (const point of path) {
        const distance = Math.hypot(point.X - x, point.Y - y);
        if (distance < nearest) nearest = distance;
      }
      if (nearest > best) {
        best = nearest;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { x: bestX, y: bestY, distance: best };
}

function asOuter(path: Path) {
  return pathArea(path) < 0 ? [...path].reverse() : path.slice();
}

function radialStats(path: Path) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of path) {
    minX = Math.min(minX, point.X);
    minY = Math.min(minY, point.Y);
    maxX = Math.max(maxX, point.X);
    maxY = Math.max(maxY, point.Y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radii = path.map((point) => Math.hypot(point.X - cx, point.Y - cy)).sort((a, b) => a - b);
  const mean = radii.reduce((sum, value) => sum + value, 0) / Math.max(1, radii.length);
  const variance = radii.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, radii.length);
  return {
    cx,
    cy,
    minX,
    minY,
    maxX,
    maxY,
    span: Math.max(maxX - minX, maxY - minY),
    cv: mean > 0 ? Math.sqrt(variance) / mean : 1,
    p15: radii[Math.floor(radii.length * 0.15)] ?? 0,
  };
}

function punchedTextShapes(paths: Paths, eyes: EyeBall[]) {
  if (!eyes.length) return pathsToShapes(paths);
  const tree = differencePaths(
    paths,
    eyes.map((eye) => eye.pupil),
  );
  const shapes = exPolygonsToShapes(tree).shapes;
  return shapes.length ? shapes : pathsToShapes(paths);
}

function eyeBaseShapes(eyes: EyeBall[]) {
  return eyes.filter((eye) => eye.fill !== false).map((eye) => new THREE.Shape(toVectors(asOuter(eye.pupil))));
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

export function outlinedMagnet(
  font: Font,
  text: string,
  letterHeight: number,
  outline: number,
  pocketRadius: number,
  charms: CharmPlacement[] = [],
  charmBase = 1.2,
) {
  const raw = text.normalize("NFC").trim().slice(0, MAX_CHARS);
  if (!raw) throw new Error("Type a name to generate this model.");
  const missing = missingGlyphs(font, raw);
  const warnings = missing.length
    ? [`This font has no glyph for ${missing.join(" ")}. Those characters were skipped.`]
    : [];
  const rings = textToRings(font, raw, letterHeight, 36, 0.4);
  if (!rings.length) throw new Error("That text has no printable outlines. Try letters or numbers.");
  const letters = ringBounds(rings);
  const centerX = (letters.minX + letters.maxX) / 2;
  const centerY = (letters.minY + letters.maxY) / 2;
  const letterPaths = clean(unionPaths(toClipper(rings)), 0.004);
  if (!letterPaths.length) throw new Error("The letters could not be combined. Try a different font.");
  let letterBase = offsetPaths(letterPaths, outline, 0.012);
  if (spanX(letterBase) + 0.2 < spanX(letterPaths)) {
    letterBase = offsetPaths(reversePaths(letterPaths), outline, 0.012);
  }
  letterBase = clean(unionPaths(letterBase), 0.008);
  if (!letterBase.length) throw new Error("The outline collapsed. Increase the outline width slightly.");
  const piece = appendCharms(sanitizeCharms(charms, 40), letters.maxX, centerY, outline, charmBase);
  const textPaths = piece.text.length ? clean(unionPaths([...letterPaths, ...piece.text]), 0.004) : letterPaths;
  const solidPaths = piece.base.length ? clean(unionPaths([...letterBase, ...piece.base]), 0.008) : letterBase;
  const pocket = placePocket(letterBase, pocketRadius);
  if (pocket.radius > 0 && pocket.radius + 0.05 < pocketRadius) {
    warnings.push("The magnet was made smaller so it stays inside the name.");
  }
  if (!pocket.shapes) warnings.push("The name is too small for a magnet pocket. Raise the letter height.");
  const pocketPaths =
    pocket.paths && piece.base.length ? clean(unionPaths([...pocket.paths, ...piece.base]), 0.008) : pocket.paths;
  const eyeballs = eyeBaseShapes(piece.eyes);
  return {
    textShapes: punchedTextShapes(textPaths, piece.eyes),
    baseShapes: [...pathsToShapes(solidPaths), ...eyeballs],
    pocketShapes: pocketPaths ? pathsToShapes(pocketPaths) : pocket.shapes,
    warnings,
    centerX,
    centerY,
    charmBounds: piece.bounds,
  };
}

function placePocket(basePaths: Paths, radius: number) {
  const polygons = ClipperLib.JS.PolyTreeToExPolygons(pathsToTree(basePaths)).map((polygon) => ({
    outer: toRing(polygon.outer),
    holes: polygon.holes.map((hole) => toRing(hole)),
  }));
  const bounds = pathBounds(basePaths);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  let size = radius;
  while (size >= 1.5) {
    const spot = findPocket(polygons, bounds, centerX, centerY, size);
    if (spot) {
      const tree = difference(basePaths, circlePath(spot.x, spot.y, size, 128));
      const cut = exPolygonsToShapes(tree);
      if (cut.holeCount) {
        return {
          shapes: cut.shapes,
          paths: clean(ClipperLib.Clipper.PolyTreeToPaths(tree), 0.008),
          radius: size,
        };
      }
    }
    size = Math.round((size - 0.5) * 10) / 10;
  }
  return { shapes: null as THREE.Shape[] | null, paths: null as Paths | null, radius: 0 };
}

function findPocket(
  polygons: { outer: Point[]; holes: Point[][] }[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  centerX: number,
  centerY: number,
  radius: number,
) {
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = bounds.minY + radius; y <= bounds.maxY - radius + 0.01; y += 1.6) {
    for (let x = bounds.minX + radius; x <= bounds.maxX - radius + 0.01; x += 1.6) {
      if (!circleInside(polygons, x, y, radius)) continue;
      const score = Math.hypot(x - centerX, y - centerY);
      if (!best || score < best.score) best = { x, y, score };
    }
  }
  return best;
}

function circleInside(polygons: { outer: Point[]; holes: Point[][] }[], cx: number, cy: number, radius: number) {
  for (let index = 0; index < 20; index += 1) {
    const angle = (index / 20) * Math.PI * 2;
    if (!insideOutline(polygons, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)) return false;
  }
  return insideOutline(polygons, cx, cy);
}

function insideOutline(polygons: { outer: Point[]; holes: Point[][] }[], x: number, y: number) {
  return polygons.some(
    (polygon) => pointInRing(x, y, polygon.outer) && polygon.holes.every((hole) => !pointInRing(x, y, hole)),
  );
}

function toRing(path: Path): Point[] {
  return path.map((point) => ({ x: point.X / SCALE, y: point.Y / SCALE }));
}

function pointInRing(x: number, y: number, ring: Point[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const prior = ring[previous];
    if (current.y > y !== prior.y > y && x < ((prior.x - current.x) * (y - current.y)) / (prior.y - current.y) + current.x) {
      inside = !inside;
    }
  }
  return inside;
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
