import type { Font } from "opentype.js";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TAG_GROUPS, type LoopStyle, type ProductSettings, type SurfacePattern, type TagShape } from "./catalog";
import { charmLayers, isLogo } from "./charms";
import {
  bounds,
  clickerLayout,
  clickerLayoutInput,
  PART,
  partsLayout,
  partsMode,
  type ClickerLayout,
  type Polygon,
  type Pt,
} from "./clicker-layout";
import { drilled, manifoldKernel, modelSolid, solidPositions, type Solid } from "./manifold";
import {
  autoHole,
  bottomOutline,
  clickerPlan,
  CUT,
  cutFrameModel,
  cutNormal,
  ensureSampleModel,
  importedModel,
  isTiltedCut,
  SAMPLE_MODEL,
  tunnelDepth,
  tunnelPoint,
  tunnelReach,
  type Tunnel,
} from "./model-import";
import { decodeSpotifyBars, spotifyLogoLoops, type SpotifyPoint } from "./spotify-code";
import { familiarParts, type TagPoint } from "./tag-shapes";
import {
  cutShapes,
  emojiFace,
  extrudeShapes,
  layoutText,
  outlinedMagnet,
  type GlyphLayout,
  type KeychainModel,
  type MeshQuality,
  type ModelCutEditor,
} from "./geometry";

const FUSE = 0.15;
const ROUND = 96;
const COLOR_FLOOR = 0.35;

export function buildProduct(
  slug: string,
  font: Font | null,
  settings: ProductSettings,
  quality: MeshQuality,
): KeychainModel {
  const curve = quality === "print" ? 16 : 10;
  switch (slug) {
    case "cable-tag":
      return cableTag(requiredFont(font), settings, quality, curve);
    case "initial-keychain":
      return initialTag(requiredFont(font), settings, quality, curve);
    case "spotify-code":
      return spotifyKeychain(font, settings, quality);
    case "articulated-name":
      return articulated(requiredFont(font), settings, quality, curve);
    case "flexi-keychain":
      return flexiKeychain(requiredFont(font), settings, quality);
    case "clicker-keychain":
      return clickerKeychain(requiredFont(font), settings, quality);
    case "model-clicker":
      return modelClicker(settings, quality);
    case "pen-holder":
      return penHolder(requiredFont(font), settings, quality, curve);
    case "picture-frame":
      return pictureFrame(requiredFont(font), settings, quality, curve);
    case "nameplate":
      return nameplate(requiredFont(font), settings, quality);
    case "planter":
      return planter(settings, curve);
    case "plant-label":
      return plantLabel(requiredFont(font), settings, quality);
    case "magnet":
      return magnet(requiredFont(font), settings, quality, curve);
    case "wall-art":
      return wallArt(requiredFont(font), settings, quality, curve);
    case "glass-marker":
      return glassMarker(requiredFont(font), settings, quality, curve);
    case "headband":
      return headband(requiredFont(font), settings, quality, curve);
    default:
      throw new Error("That model is not available.");
  }
}

function spotifyKeychain(font: Font | null, settings: ProductSettings, quality: MeshQuality): KeychainModel {
  const bars = decodeSpotifyBars(settings.spotifyBars);
  if (bars.length < 20) throw new Error("Paste a Spotify link and press Generate.");
  const length = clamp(settings.maxLength, 70, 160);
  const width = clamp(settings.photoWidth, 18, 34);
  const bodyDepth = clamp(settings.baseThickness, 2, 6);
  const requested = clamp(settings.textThickness, 0.6, 2.2);
  const debossed = settings.relief === "debossed";
  const wantedDeboss = clamp(settings.debossDepth, 0.3, 2.2);
  const holeRadius = Math.min(clamp(settings.holeDiameter, 3, 8) / 2, width * 0.2);
  const endPad = 2.2;
  const holeY = length / 2 - endPad - holeRadius;
  const sidePad = 1.8;
  const codeTop = holeY - holeRadius - 2.4;
  const codeBottom = -length / 2 + sidePad;
  const usable = Math.max(8, codeTop - codeBottom);
  const widthScale = Math.max(0.04, (width - sidePad * 2) / 100);
  const heightScale = usable / 400;
  const scale = Math.min(widthScale, heightScale);
  const centerY = codeTop - 200 * scale;
  const back = backLetterShapes(
    font,
    settings.backText,
    settings.textFlow,
    quality,
    width,
    length,
    holeY,
    holeRadius,
    settings.letterHeight,
  );
  const sides = 1 + (debossed && back.shapes.length ? 1 : 0);
  const maxPocket = Math.max(COLOR_FLOOR + 0.2, (bodyDepth - 0.8) / sides);
  const pocket = debossed ? Math.min(wantedDeboss + COLOR_FLOOR, maxPocket) : 0;
  const raised = debossed ? 0 : requested;
  const sizeWarning = back.warnings.find((warning) => warning.startsWith("Text size"));
  const warnings = [
    ...(sizeWarning ? [sizeWarning] : []),
    debossed
      ? "The code and back text are pressed into the tag. Use a contrasting color so Spotify can scan the recess."
      : "The code and back text are raised. Use a contrasting color so Spotify can scan it.",
    "Orbit underneath to see the back text. It uses the code color.",
  ];
  if (heightScale + 0.001 < widthScale) {
    warnings.push("The tag is short for this width, so the code was scaled down. A longer tag scans more reliably.");
  }
  if (debossed && pocket + 0.05 < wantedDeboss + COLOR_FLOOR) {
    warnings.push("The recess was kept shallow so the tag stays strong enough to print.");
  }
  warnings.push(...back.warnings.filter((warning) => warning !== sizeWarning));

  const codeShapes = [
    spotifyLogo(scale, centerY),
    ...bars.map((bar) =>
      horizontalCapsule(
        (bar.y + bar.h / 2 - 50) * scale,
        (200 - (bar.x + bar.w / 2)) * scale + centerY,
        bar.h * scale,
        Math.max(0.6, bar.w * scale),
      ),
    ),
  ];
  const pill = pillWithHole(width, length, holeRadius, holeY);
  const backStick = back.shapes.length ? raised : 0;
  const frontPocket = debossed ? pocket : 0;
  const backPocket = debossed && back.shapes.length ? pocket : 0;
  const detail: THREE.BufferGeometry[] = [];
  const body: THREE.BufferGeometry[] = [];

  if (back.shapes.length && !debossed) {
    const letters = extrudeShapes(back.shapes, raised, 2);
    detail.push(letters);
  }
  if (backPocket > COLOR_FLOOR) {
    body.push(extrudeShapes(cutShapes([pill], back.shapes), backPocket, ROUND).translate(0, 0, backStick));
    const inlay = extrudeShapes(back.shapes, COLOR_FLOOR, 2);
    inlay.translate(0, 0, backStick + backPocket - COLOR_FLOOR);
    detail.push(inlay);
  }
  const middleStart = backStick + backPocket;
  const middleDepth = bodyDepth - backPocket - frontPocket;
  body.push(extrudeShapes([pill], middleDepth + (backPocket || frontPocket ? FUSE : 0), ROUND).translate(0, 0, middleStart - (backPocket ? FUSE : 0)));
  if (frontPocket > COLOR_FLOOR) {
    body.push(
      extrudeShapes(cutShapes([pill], codeShapes), frontPocket, ROUND).translate(0, 0, backStick + bodyDepth - frontPocket),
    );
    const inlay = extrudeShapes(codeShapes, COLOR_FLOOR, ROUND);
    inlay.translate(0, 0, backStick + bodyDepth - frontPocket);
    detail.push(inlay);
  }
  if (!debossed) {
    const code = extrudeShapes(codeShapes, raised + FUSE, ROUND);
    code.translate(0, 0, backStick + bodyDepth - FUSE);
    detail.push(code);
  }
  if (!detail.length) throw new Error("That Spotify code has no printable detail.");
  return pack(fuse(detail), fuse(body), warnings);
}

function backLetterShapes(
  font: Font | null,
  raw: string,
  flow: ProductSettings["textFlow"],
  quality: MeshQuality,
  width: number,
  length: number,
  holeY: number,
  holeRadius: number,
  letterHeight: number,
) {
  const text = raw.trim();
  if (!text) return { shapes: [] as THREE.Shape[], warnings: [] as string[] };
  if (!font) throw new Error("Choose a font first.");
  const margin = 1.8;
  const bandTop = holeY - holeRadius - 2;
  const bandBottom = -length / 2 + width / 2 + 1;
  const band = Math.max(10, bandTop - bandBottom);
  const room = Math.max(6, width - margin * 2);
  const centerBand = (bandTop + bandBottom) / 2;
  const wanted = clamp(letterHeight, 4, 24);
  if (flow === "horizontal") return horizontalBackText(font, text, quality, band, room, centerBand, wanted);
  const words = text.split(/\s+/).filter(Boolean).slice(0, 4);
  const glyphs: GlyphLayout[] = [];
  const warnings: string[] = [];
  const natural = 8;
  for (const word of words) {
    const layout = layoutText(font, word, natural, quality, { maxChars: 14 });
    glyphs.push(...layout.glyphs);
    warnings.push(...layout.warnings);
  }
  if (!glyphs.length) return { shapes: [], warnings };
  const maxW = Math.max(...glyphs.map((glyph) => glyph.maxX - glyph.minX));
  const sumH = glyphs.reduce((sum, glyph) => sum + (glyph.maxY - glyph.minY), 0);
  const gap = natural * 0.18;
  const wordGap = natural * 0.55;
  const requested = wanted / natural;
  const fit = Math.min(room / Math.max(0.1, maxW), band / Math.max(0.1, sumH + gap * glyphs.length), requested);
  if (fit < requested - 0.02) warnings.push("Text size was reduced so it stays on the tag.");
  const spans = glyphs.map((glyph) => (glyph.maxY - glyph.minY) * fit);
  const total = spans.reduce((sum, span) => sum + span, 0) + gap * fit * Math.max(0, glyphs.length - 1) + (words.length > 1 ? wordGap * fit : 0);
  let cursor = centerBand + total / 2;
  const shapes: THREE.Shape[] = [];
  let wordIndex = 0;
  let seenInWord = 0;
  const wordLengths = words.map((word) => Array.from(word).length);
  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    const span = spans[index];
    cursor -= span / 2;
    const centerX = (glyph.minX + glyph.maxX) / 2;
    const centerGlyphY = (glyph.minY + glyph.maxY) / 2;
    for (const shape of glyph.shapes) {
      shapes.push(
        mapShape(shape, (x, y) => ({
          x: (x - centerX) * fit,
          y: (y - centerGlyphY) * fit + cursor,
        })),
      );
    }
    cursor -= span / 2 + gap * fit;
    seenInWord += glyph.char.length;
    if (seenInWord >= (wordLengths[wordIndex] ?? 0)) {
      cursor -= wordGap * fit;
      wordIndex += 1;
      seenInWord = 0;
    }
  }
  return { shapes, warnings };
}

function horizontalBackText(
  font: Font,
  text: string,
  quality: MeshQuality,
  band: number,
  room: number,
  centerBand: number,
  wanted: number,
) {
  const natural = 8;
  const layout = layoutText(font, text, natural, quality, { maxChars: 18 });
  const glyphs = layout.glyphs;
  const minX = Math.min(...glyphs.map((glyph) => glyph.minX));
  const maxX = Math.max(...glyphs.map((glyph) => glyph.maxX));
  const minY = Math.min(...glyphs.map((glyph) => glyph.minY));
  const maxY = Math.max(...glyphs.map((glyph) => glyph.maxY));
  const textW = Math.max(0.1, maxX - minX);
  const textH = Math.max(0.1, maxY - minY);
  const requested = wanted / natural;
  const fit = Math.min(band / textW, room / textH, requested);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const warnings = [...layout.warnings];
  if (fit < requested - 0.02) warnings.push("Text size was reduced so it stays on the tag.");
  return {
    shapes: layout.shapes.map((shape) =>
      mapShape(shape, (x, y) => ({
        x: -(y - centerY) * fit,
        y: centerBand - (x - centerX) * fit,
      })),
    ),
    warnings,
  };
}

function mapShape(shape: THREE.Shape, map: (x: number, y: number) => { x: number; y: number }) {
  const next = new THREE.Shape(
    shape.getPoints(2).map((point) => {
      const moved = map(point.x, point.y);
      return new THREE.Vector2(moved.x, moved.y);
    }),
  );
  for (const hole of shape.holes) {
    next.holes.push(
      new THREE.Path(
        hole.getPoints(2).map((point) => {
          const moved = map(point.x, point.y);
          return new THREE.Vector2(moved.x, moved.y);
        }),
      ),
    );
  }
  return next;
}

function spotifyLogo(scale: number, centerY: number) {
  const loops = spotifyLogoLoops().map((loop) => loop.map((point) => mapLogo(point, scale, centerY)));
  const outer = loops[0] ?? [];
  if (signedArea(outer) < 0) outer.reverse();
  const shape = new THREE.Shape(outer.map((point) => new THREE.Vector2(point.x, point.y)));
  for (const hole of loops.slice(1)) {
    if (signedArea(hole) > 0) hole.reverse();
    shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(point.x, point.y))));
  }
  return shape;
}

function mapLogo(point: SpotifyPoint, scale: number, centerY: number) {
  return { x: (50 - point.y) * scale, y: (point.x + 100) * scale + centerY };
}

function horizontalCapsule(centerX: number, centerY: number, length: number, thickness: number) {
  const radius = thickness / 2;
  const shape = new THREE.Shape();
  if (length <= thickness + 0.05) {
    shape.absarc(centerX, centerY, radius, 0, Math.PI * 2, false);
    return shape;
  }
  const half = length / 2 - radius;
  shape.absarc(centerX - half, centerY, radius, Math.PI / 2, Math.PI * 1.5, false);
  shape.absarc(centerX + half, centerY, radius, -Math.PI / 2, Math.PI / 2, false);
  return shape;
}

function pillWithHole(width: number, length: number, holeRadius: number, holeY: number) {
  const shape = roundedRect(width, length, width / 2);
  const hole = new THREE.Path();
  hole.absarc(0, holeY, holeRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function requiredFont(font: Font | null) {
  if (!font) throw new Error("Choose a font first.");
  return font;
}

function initialTag(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const raw = settings.text.trim();
  if (!raw) throw new Error("Type a letter for the tag.");
  const text = Array.from(raw).slice(0, 2).join("");
  const radius = clamp(settings.tagSize, 32, 80) / 2;
  const shape = tagShapeOf(settings.tagShape);
  const layout = layoutText(font, text, clamp(settings.letterHeight, 8, 40), quality, { maxChars: 2 });
  const bounds = boundsOf(layout.glyphs);
  const letterW = Math.max(0.1, bounds.maxX - bounds.minX);
  const letterH = Math.max(0.1, bounds.maxY - bounds.minY);
  const holeRadius = Math.min(clamp(settings.holeDiameter, 3, 8) / 2, radius * 0.18);
  const tag = tagGeometry(shape, radius);
  const outline = tag.outer;
  const holeY = holeCenterY(outline, tag.holes, holeRadius);
  const span = spanContaining(outline, Math.min(-1, holeY - holeRadius - 3));
  const roomW = span ? Math.max(8, span.max - span.min - 2.4) : radius * 1.5;
  const room = Math.max(6, holeY - holeRadius - 2.2 + radius * 0.62);
  const fit = Math.min(1, roomW / letterW, room / letterH);
  const bodyDepth = clamp(settings.baseThickness, 2, 6);
  const letters = extrudeShapes(layout.shapes, clamp(settings.textThickness, 0.8, 3) + FUSE, 2);
  letters.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2, 0);
  letters.scale(fit, fit, 1);
  letters.translate(0, Math.min(0, holeY - holeRadius - 1.6 - (letterH * fit) / 2), bodyDepth - FUSE);
  const base = extrudeShapes([tagShapeMesh(shape, radius, outline, tag.holes, holeY, holeRadius)], bodyDepth, Math.max(curve, 32));
  const warnings = [...layout.warnings];
  if (Array.from(raw).length > 2) warnings.push("Only the first two letters fit on this tag.");
  if (fit < 0.995) warnings.push("Letter height was reduced so it stays inside the tag.");
  warnings.push("The hole is at the top of the tag for a keyring.");
  return pack(letters, base, warnings);
}

function tagShapeOf(shape: TagShape): TagShape {
  const known = TAG_GROUPS.some((group) => group.shapes.some((item) => item.value === shape));
  return known ? shape : "circle";
}

function tagGeometry(shape: TagShape, radius: number) {
  if (shape === "flower") return { outer: flowerOutline(radius), holes: [] as TagPoint[][] };
  if (shape === "heart") return { outer: fitOutline(heartRaw(72), radius), holes: [] as TagPoint[][] };
  if (shape === "star") return { outer: starOutline(radius), holes: [] as TagPoint[][] };
  if (shape === "square") return { outer: squareOutline(radius), holes: [] as TagPoint[][] };
  if (shape === "circle") return { outer: circleOutline(radius, 64), holes: [] as TagPoint[][] };
  const raw = familiarParts(shape);
  return fitAround(raw.outer, raw.holes, raw.focus, radius);
}

function tagShapeMesh(
  shape: TagShape,
  radius: number,
  outline: TagPoint[],
  holes: TagPoint[][],
  holeY: number,
  holeRadius: number,
) {
  const path = shape === "circle" ? new THREE.Shape() : new THREE.Shape(outline.map((point) => new THREE.Vector2(point.x, point.y)));
  if (shape === "circle") path.absarc(0, 0, radius, 0, Math.PI * 2, false);
  for (const loop of holes) path.holes.push(toPath(loop));
  const hole = new THREE.Path();
  hole.absarc(0, holeY, holeRadius, 0, Math.PI * 2, true);
  path.holes.push(hole);
  return path;
}

function toPath(loop: TagPoint[]) {
  const path = new THREE.Path();
  path.moveTo(loop[0].x, loop[0].y);
  for (let index = 1; index < loop.length; index += 1) path.lineTo(loop[index].x, loop[index].y);
  path.closePath();
  return path;
}

function holeCenterY(outline: TagPoint[], holes: TagPoint[][], holeRadius: number) {
  const top = outline.reduce((max, point) => Math.max(max, point.y), 0);
  let y = top - holeRadius - 2.2;
  for (let step = 0; step < 48; step += 1) {
    if (circleInside(outline, 0, y, holeRadius + 1.7) && clearOfHoles(holes, 0, y, holeRadius + 0.6)) return y;
    y -= 0.8;
  }
  return y;
}

function clearOfHoles(holes: TagPoint[][], x: number, y: number, radius: number) {
  for (const loop of holes) {
    if (pointInside(loop, x, y)) return false;
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      if (pointInside(loop, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)) return false;
    }
  }
  return true;
}

function spanContaining(outline: TagPoint[], y: number) {
  const hits: number[] = [];
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index, index += 1) {
    const current = outline[index];
    const prior = outline[previous];
    if ((prior.y > y) === (current.y > y)) continue;
    const t = (y - prior.y) / (current.y - prior.y);
    hits.push(prior.x + t * (current.x - prior.x));
  }
  hits.sort((left, right) => left - right);
  for (let index = 0; index + 1 < hits.length; index += 2) {
    if (hits[index] <= 0.5 && hits[index + 1] >= -0.5) return { min: hits[index], max: hits[index + 1] };
  }
  return null;
}

function circleInside(outline: { x: number; y: number }[], cx: number, cy: number, radius: number) {
  for (let index = 0; index < 20; index += 1) {
    const angle = (index / 20) * Math.PI * 2;
    if (!pointInside(outline, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)) return false;
  }
  return pointInside(outline, cx, cy);
}

function pointInside(outline: { x: number; y: number }[], x: number, y: number) {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index, index += 1) {
    const current = outline[index];
    const prior = outline[previous];
    const crosses = current.y > y !== prior.y > y;
    if (crosses && x < ((prior.x - current.x) * (y - current.y)) / (prior.y - current.y) + current.x) {
      inside = !inside;
    }
  }
  return inside;
}

function circleOutline(radius: number, segments: number) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function flowerOutline(radius: number) {
  const petals = 5;
  const petalR = 0.48;
  const orbit = 0.4;
  const steps = 100;
  const raw = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let farthest = 0.18;
    for (let petal = 0; petal < petals; petal += 1) {
      const petalAngle = -Math.PI / 2 + (petal / petals) * Math.PI * 2;
      const px = Math.cos(petalAngle) * orbit;
      const py = Math.sin(petalAngle) * orbit;
      const b = -2 * (dx * px + dy * py);
      const c = px * px + py * py - petalR * petalR;
      const disc = b * b - 4 * c;
      if (disc < 0) continue;
      const distance = (-b + Math.sqrt(disc)) / 2;
      if (distance > farthest) farthest = distance;
    }
    return { x: dx * farthest, y: dy * farthest };
  });
  return fitOutline(raw, radius);
}

function heartRaw(segments: number) {
  return Array.from({ length: segments }, (_, index) => {
    const t = (index / segments) * Math.PI * 2;
    return {
      x: 16 * Math.sin(t) ** 3,
      y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
    };
  });
}

function starOutline(radius: number) {
  const raw = Array.from({ length: 10 }, (_, index) => {
    const angle = Math.PI / 2 + (index * Math.PI) / 5;
    const pointRadius = index % 2 === 0 ? 1 : 0.48;
    return { x: Math.cos(angle) * pointRadius, y: Math.sin(angle) * pointRadius };
  });
  return fitOutline(raw, radius);
}


function winding(points: TagPoint[]) {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

function signedArea(points: TagPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return area;
}

function fitAround(outer: TagPoint[], holes: TagPoint[][], focus: TagPoint, radius: number) {
  const bounds = outer.reduce(
    (box, point) => ({
      minX: Math.min(box.minX, point.x),
      minY: Math.min(box.minY, point.y),
      maxX: Math.max(box.maxX, point.x),
      maxY: Math.max(box.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const scale = (radius * 2) / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 0.01);
  const map = (point: TagPoint) => ({
    x: (point.x - focus.x) * scale,
    y: (point.y - focus.y) * scale,
  });
  return {
    outer: winding(outer.map(map)),
    holes: holes.map((loop) => {
      const next = loop.map(map);
      return signedArea(next) > 0 ? [...next].reverse() : next;
    }),
  };
}

function squareOutline(radius: number) {
  const half = radius * 0.86;
  const corner = half * 0.42;
  const shape = roundedRect(half * 2, half * 2, corner);
  const points = shape.getPoints(8);
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function fitOutline(raw: { x: number; y: number }[], radius: number) {
  const bounds = raw.reduce(
    (box, point) => ({
      minX: Math.min(box.minX, point.x),
      minY: Math.min(box.minY, point.y),
      maxX: Math.max(box.maxX, point.x),
      maxY: Math.max(box.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const scale = (radius * 2) / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 0.01);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  return raw.map((point) => ({
    x: (point.x - midX) * scale,
    y: (point.y - midY) * scale,
  }));
}

function cableTag(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const layout = layoutText(font, settings.text, settings.letterHeight, quality);
  const bounds = boundsOf(layout.glyphs);
  const letters = extrudeShapes(layout.shapes, settings.textThickness, 1);
  const radius = clamp(settings.cableDiameter, 3, 12) / 2;
  const wall = clamp(settings.baseThickness, 1.2, 3);
  const length = Math.max(12, bounds.maxX - bounds.minX + 2);
  const clip = channel(length, radius, wall, curve);
  clip.translate((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0);
  letters.translate(0, 0, radius + wall - 0.2);
  return pack(letters, clip, [
    ...layout.warnings,
    "The opening faces the print bed. Slide the cable in after printing.",
  ]);
}

function articulated(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const bodyDepth = clamp(settings.baseThickness, 4.8, 8);
  const capDepth = clamp(settings.textThickness, 0.8, 3);
  const linkHeight = clamp(settings.linkHeight, 12, 40);
  const layout = layoutText(font, settings.text, clamp(settings.letterHeight, 8, 32), quality);
  const glyphs = layout.glyphs;
  const knuckleRadius = clamp(linkHeight * 0.12, 1.8, 3.2);
  const plateGap = knuckleRadius * 2 + 0.7;
  let cursor = knuckleRadius + 2.4;
  if (settings.linkStyle === "block") {
    return blockArticulated(
      layout,
      bodyDepth,
      capDepth,
      clamp(settings.holeDiameter, 3, 8) / 2,
      clamp(settings.linkSize || 6, 5, 14),
      clamp(settings.letterGap || 0, 0, 24),
    );
  }
  const plates = glyphs.map((glyph) => {
    const glyphWidth = Math.max(2.8, glyph.maxX - glyph.minX);
    const width = Math.max(glyphWidth + 3.2, linkHeight * 0.62);
    const plate = { glyph, x: cursor, width };
    cursor += width + plateGap;
    return plate;
  });

  const bodies: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  for (let index = 0; index < plates.length; index += 1) {
    const plate = plates[index];
    const centerX = plate.x + plate.width / 2;
    const body = extrudeShapes([roundedRect(plate.width, linkHeight, 1.8)], bodyDepth, 2);
    body.translate(centerX, 0, 0);
    bodies.push(body);

    const glyph = plate.glyph;
    const glyphWidth = Math.max(0.1, glyph.maxX - glyph.minX);
    const glyphHeight = Math.max(0.1, glyph.maxY - glyph.minY);
    const scale = Math.min(1, (plate.width - 2.4) / glyphWidth, (linkHeight - 2.6) / glyphHeight);
    const cap = extrudeShapes(glyph.shapes, capDepth + FUSE, 1);
    cap.translate(-(glyph.minX + glyph.maxX) / 2, -(glyph.minY + glyph.maxY) / 2, 0);
    cap.scale(scale, scale, 1);
    cap.translate(centerX, 0, bodyDepth - FUSE);
    caps.push(cap);

    if (index < plates.length - 1) {
      const jointX = plate.x + plate.width + plateGap / 2;
      bodies.push(...linkJoint(jointX, plate.x + plate.width, plates[index + 1].x, bodyDepth, knuckleRadius));
    }
  }

  const holeRadius = Math.min(clamp(settings.holeDiameter, 3, 8) / 2, linkHeight / 2 - 2);
  const tab = extrudeShapes([ring(holeRadius + 1.8, holeRadius)], bodyDepth, curve);
  tab.translate(plates[0].x - holeRadius - 0.5, 0, 0);
  bodies.push(tab);

  return pack(fuse(caps), fuse(bodies), [
    ...layout.warnings,
    "Print it flat. The hinge pin is captured, with about 0.3 mm of clearance so the links can still flex.",
  ]);
}

// Print-in-place flexi chain: each bead's tongue sits between the next bead's top and bottom
// fork layers, turning on a pin hidden inside, so from above every joint reads as one flat bar.
const FLEXI_Z_CLEAR = 0.35;
const FLEXI_PIN_CLEAR = 0.35;
const FLEXI_NOSE_CLEAR = 0.45;

export function flexiMetrics(size: number, thickness: number) {
  const gap = Math.max(6, size * 0.36);
  const nose = gap / 2 - FLEXI_NOSE_CLEAR;
  const lip = clamp(thickness * 0.27, 1.4, 2);
  const pin = clamp(size * 0.065, 1.1, 1.5);
  return {
    gap,
    nose,
    lip,
    pin,
    bore: pin + FLEXI_PIN_CLEAR,
    tongueBottom: lip + FLEXI_Z_CLEAR,
    tongueTop: thickness - lip - FLEXI_Z_CLEAR,
  };
}

function flexiKeychain(font: Font, settings: ProductSettings, quality: MeshQuality) {
  const size = clamp(settings.linkSize || 18, 14, 26);
  const thickness = clamp(settings.baseThickness, 5, 8);
  const capDepth = clamp(settings.textThickness, 0.8, 2.4);
  const holeRadius = clamp(settings.holeDiameter, 3, 6) / 2;
  const chars = Array.from(settings.text.normalize("NFC"))
    .filter((char) => char.trim())
    .slice(0, 16);
  const icons = settings.charms.slice(0, Math.max(0, 16 - chars.length));
  const tiles = chars.length + icons.length;
  if (!tiles) throw new Error("Type a name or add an emoji.");

  const fine = quality === "print" ? 40 : 20;
  const joint = flexiMetrics(size, thickness);
  const pitch = size + joint.gap;
  const embed = 0.6;
  const letterBox = size * 0.74;
  const warnings = [
    "Print it flat with no supports. Each joint is a print-in-place hinge with a hidden pin, so the beads flex once it is off the bed. Add a metal split ring through the loop.",
  ];
  const bodies: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];

  for (let index = 0; index < tiles; index += 1) {
    const cx = index * pitch + size / 2;
    const bead = extrudeShapes([roundedRect(size, size, size * 0.26)], thickness, quality === "print" ? 12 : 6);
    bead.translate(cx, 0, 0);
    bodies.push(bead);

    const icon =
      index < chars.length
        ? flexiLetter(font, chars[index], letterBox, size * 0.66, capDepth + FUSE, quality)
        : capIcon(icons[index - chars.length].id, size * 0.72, capDepth + FUSE);
    if (icon) {
      icon.translate(cx, 0, thickness - FUSE);
      caps.push(icon);
    } else if (index >= chars.length) {
      warnings.push("One emoji did not load. Add it again.");
    }

    if (index < tiles - 1) {
      const leftFace = cx + size / 2;
      const jointX = leftFace + joint.gap / 2;
      const reach = joint.gap / 2 + embed;
      const tongue = extrudeShapes(
        [noseBar(reach, joint.nose, joint.bore)],
        joint.tongueTop - joint.tongueBottom,
        fine,
      );
      tongue.translate(jointX, 0, joint.tongueBottom);
      bodies.push(tongue);
      for (const z of [0, thickness - joint.lip]) {
        const fork = extrudeShapes([noseBar(reach, joint.nose)], joint.lip, fine);
        fork.rotateZ(Math.PI);
        fork.translate(jointX, 0, z);
        bodies.push(fork);
      }
      const pin = extrudeShapes([disk(joint.pin)], thickness - joint.lip * 2 + 0.4, fine);
      pin.translate(jointX, 0, joint.lip - 0.2);
      bodies.push(pin);
    }
  }

  const loopRadius = holeRadius + 2;
  const loopX = -(holeRadius + 1.7);
  const loop = extrudeShapes([noseBar(-loopX + embed, loopRadius, holeRadius)], thickness, fine);
  loop.rotateZ(Math.PI);
  loop.translate(loopX, 0, 0);
  bodies.push(loop);

  const span = tiles * pitch - joint.gap + loopRadius - loopX;
  if (span > 248) warnings[0] += " This name is long for a 256 mm bed. Remove a letter or use a smaller bead.";
  return pack(fuse(caps), fuse(bodies), warnings);
}

// Cherry MX-compatible switch: 14 mm plate cutout in a 1.5 mm plate, about 8.3 mm of
// body and pins below the plate top, and a 4 mm cross stem. Printed holes run small,
// so the cutout and the cross get a little extra.
export const CLICKER = {
  unit: 23.5,
  floor: 1.6,
  below: 8,
  cavity: 15.2,
  plate: 1.5,
  cutout: 14.1,
  wall: 8,
  pocket: 19.4,
  cap: 18.4,
  skirtWall: 1,
  skirt: 5.5,
  post: 2.75,
  socket: 4,
  crossLength: 4.2,
  crossWidth: 1.35,
  capHeight: 9,
  capTop: 15.4,
  // Pockets one wall apart, so the walls between keys match the outer walls.
  pitch: 19.4 + (23.5 - 19.4) / 2,
};

export function clickerLength(keys: number) {
  return CLICKER.unit + (keys - 1) * CLICKER.pitch;
}

// Rounded square ring, counter-clockwise, at height z.
function squareRing(cx: number, cy: number, size: number, radius: number, corner: number, z: number) {
  const h = size / 2 - radius;
  const points: THREE.Vector3[] = [];
  [[h, h], [-h, h], [-h, -h], [h, -h]].forEach(([x, y], index) => {
    for (let step = 0; step <= corner; step += 1) {
      const angle = (index + step / corner) * (Math.PI / 2);
      points.push(new THREE.Vector3(cx + x + Math.cos(angle) * radius, cy + y + Math.sin(angle) * radius, z));
    }
  });
  return points;
}

// Flat face at one height bounded by `outer` with `holes` cut out.
function holedFace(outer: THREE.Vector3[], holes: THREE.Vector3[][], facing: 1 | -1) {
  const flat = (ring: THREE.Vector3[]) => ring.map((point) => new THREE.Vector2(point.x, point.y));
  const contour = flat(outer);
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes.map(flat));
  const all = [outer, ...holes].flat();
  return surface(all.flatMap((point) => [point.x, point.y, point.z]), facedUp(all, triangles, facing));
}

// Triangulation winds every triangle the same way, including zero-area slivers, so the
// whole face is flipped at once from its total area.
function facedUp(points: { x: number; y: number }[], triangles: number[][], facing: 1 | -1) {
  const area = triangles.reduce((sum, [a, b, c]) => {
    const [p, q, r] = [points[a], points[b], points[c]];
    return sum + (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  }, 0);
  return triangles.flatMap(([a, b, c]) => (area > 0 === (facing === 1) ? [a, b, c] : [a, c, b]));
}

const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

// Pattern height from 0 to 1 at distance `s` around a wall of length `around` and height
// `z` (mm). Periods along the wall are snapped so the pattern closes without a seam.
function patternHeight(pattern: SurfacePattern, s: number, z: number, around: number) {
  const snap = (period: number) => around / Math.max(1, Math.round(around / period));
  const crest = (u: number) => smoothstep(0.35, 0.65, 0.5 + 0.5 * Math.cos(2 * Math.PI * u));
  const tent = (u: number) => 1 - 2 * Math.abs(u - Math.round(u));
  switch (pattern) {
    case "ribs":
      return crest(s / snap(2.4));
    case "stripes":
      return crest(z / 2.4);
    case "waves":
      return crest((z + 0.9 * Math.sin((2 * Math.PI * s) / snap(9))) / 2.6);
    case "diamond": {
      const period = snap(3.2);
      return Math.max(smoothstep(0.55, 0.8, tent((s + z) / period)), smoothstep(0.55, 0.8, tent((s - z) / period)));
    }
    case "dots": {
      const period = snap(3);
      const row = Math.round(z / 2.6);
      const shift = row % 2 ? period / 2 : 0;
      const column = Math.round((s - shift) / period) * period + shift;
      return 1 - smoothstep(0.55, 0.95, Math.hypot(s - column, z - row * 2.6));
    }
    default:
      return 0;
  }
}

type Samples = { points: Pt[]; normals: Pt[]; around: number };

// Points evenly spaced around a counterclockwise outline, with outward normals.
function sampleOutline(outline: Pt[], spacing: number): Samples {
  const lengths = outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const around = lengths.reduce((sum, length) => sum + length, 0);
  const count = Math.max(48, Math.ceil(around / spacing));
  const points: Pt[] = [];
  let edge = 0;
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const s = (index / count) * around;
    while (edge < outline.length - 1 && start + lengths[edge] < s) start += lengths[edge++];
    const a = outline[edge];
    const b = outline[(edge + 1) % outline.length];
    const t = lengths[edge] > 0 ? (s - start) / lengths[edge] : 0;
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  const normals = points.map((_, index) => {
    const before = points[(index + count - 1) % count];
    const after = points[(index + 1) % count];
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    return { x: (after.y - before.y) / length, y: -(after.x - before.x) / length };
  });
  return { points, normals, around };
}

// The sampled outline at height z, each point pushed out along its normal by `push(s, z)`.
function ringAt(
  samples: Samples,
  z: number,
  push: (s: number, z: number, around: number) => number = () => 0,
  dx = 0,
  dy = 0,
) {
  const { points, normals, around } = samples;
  return points.map((point, index) => {
    const out = push((index / points.length) * around, z, around);
    return new THREE.Vector3(dx + point.x + normals[index].x * out, dy + point.y + normals[index].y * out, z);
  });
}

// Heights from `from` to `to` no more than `step` apart, both ends included.
function levels(from: number, to: number, step: number) {
  const count = Math.max(1, Math.ceil((to - from) / step));
  return Array.from({ length: count + 1 }, (_, index) => from + ((to - from) * index) / count);
}

const HOUSING_RELIEF = 0.6;
const CAP_RELIEF = 0.4;

// One closed shell: outer wall, then per socket a pocket for the keycap, the 1.5 mm plate
// the switch clips into, and the cavity for its body and pins. Stacked slabs instead print
// a visible seam at every join.
function clickerHousing(
  layout: Pick<ClickerLayout, "outline" | "pocket" | "positions">,
  corner: number,
  pattern: SurfacePattern,
  spacing: number,
  abovePlate = CLICKER.wall,
  rim?: { recess: Pt[]; height: number },
) {
  const k = CLICKER;
  const z = [0, k.floor, k.floor + k.below, k.floor + k.below + k.plate, k.floor + k.below + k.plate + abovePlate];
  const top = z[4] + (rim?.height ?? 0);
  const outer = sampleOutline(layout.outline, spacing);
  const pocket = sampleOutline(layout.pocket, spacing);
  // Raised pattern, fading out before the bottom and top edges so those stay flat.
  const push = (s: number, height: number, around: number) =>
    HOUSING_RELIEF *
    patternHeight(pattern, s, height, around) *
    smoothstep(0.8, 2, height) *
    (1 - smoothstep(top - 2, top - 0.8, height));
  const wall = (pattern === "plain" ? [z[0], top] : levels(z[0], top, spacing)).map((height) =>
    ringAt(outer, height, push),
  );
  const pockets = (level: number) => layout.positions.map(({ x, y }) => ringAt(pocket, level, undefined, x, y));
  const parts = [holedFace(wall[0], [], -1), loft(wall, false)];
  if (rim) {
    const recess = sampleOutline(rim.recess, spacing);
    const recessTop = ringAt(recess, top);
    const recessFloor = ringAt(recess, z[4]);
    parts.push(
      holedFace(wall[wall.length - 1], [recessTop], 1),
      loft([recessFloor, recessTop], true),
      holedFace(recessFloor, pockets(z[4]), 1),
    );
  } else {
    parts.push(holedFace(wall[wall.length - 1], pockets(z[4]), 1));
  }
  const tops = pockets(z[4]);
  pockets(z[3]).forEach((ring, index) => {
    const { x, y } = layout.positions[index];
    const pocketTop = tops[index];
    const cutTop = squareRing(x, y, k.cutout, 0.3, corner, z[3]);
    const cutBottom = squareRing(x, y, k.cutout, 0.3, corner, z[2]);
    const cavityTop = squareRing(x, y, k.cavity, 0.6, corner, z[2]);
    const cavityBottom = squareRing(x, y, k.cavity, 0.6, corner, z[1]);
    parts.push(
      loft([ring, pocketTop], true),
      holedFace(ring, [cutTop], 1),
      loft([cutBottom, cutTop], true),
      holedFace(cavityTop, [cutBottom], -1),
      loft([cavityBottom, cavityTop], true),
      holedFace(cavityBottom, [], 1),
    );
  });
  return fuse(parts);
}

function clickerKeychain(font: Font, settings: ProductSettings, quality: MeshQuality) {
  if (partsMode(settings)) return partsClicker(settings, quality);
  const chars = Array.from(settings.text.normalize("NFC"))
    .filter((char) => char.trim())
    .slice(0, 8);
  const icons = settings.charms.slice(0, Math.max(0, 8 - chars.length));
  const keys = chars.length + icons.length;
  if (!keys) throw new Error("Type a letter or add an emoji or logo.");
  const letterSize = clamp(settings.letterHeight, 6, 13);
  const letterDepth = clamp(settings.textThickness, 0.6, 1.6);
  const holeRadius = clamp(settings.holeDiameter, 3, 6) / 2;
  const fine = quality === "print" ? 40 : 20;
  const corner = quality === "print" ? 10 : 6;
  const k = CLICKER;
  const layout = clickerLayout(clickerLayoutInput(settings, keys));
  if (layout.error) throw new Error(layout.error);

  const spacing = quality === "print" ? 0.3 : 0.5;
  const onHousing = settings.surfaceOn !== "caps" ? settings.surface : "plain";
  const onCaps = settings.surfaceOn !== "housing" ? settings.surface : "plain";
  const bodies: THREE.BufferGeometry[] = [
    clickerHousing(layout, corner, onHousing, spacing),
    ...placedLoop(settings, layout.outline, holeRadius, fine),
  ];
  const letters: THREE.BufferGeometry[] = [];

  // Keycaps in a row in front of the housing, each centered on its own switch.
  const capBox = bounds(layout.cap);
  const housingBox = bounds(layout.outline);
  const capY = housingBox.minY - 6 - capBox.maxY;
  const capStep = capBox.maxX - capBox.minX + 4;
  const capStart = housingBox.minX - capBox.minX;
  for (let index = 0; index < keys; index += 1) {
    const x = capStart + index * capStep;
    for (const part of keycap(layout.cap, fine, corner, onCaps, spacing)) {
      part.translate(x, capY, 0);
      bodies.push(part);
    }
    const mark =
      index < chars.length
        ? flexiLetter(font, chars[index], k.capTop - 3, letterSize, letterDepth + FUSE, quality)
        : capIcon(icons[index - chars.length].id, k.capTop - 3, letterDepth + FUSE);
    if (mark) {
      mark.translate(x, capY, k.capHeight - FUSE);
      letters.push(mark);
    }
  }

  const warnings = [
    `Needs ${keys} Cherry MX-compatible switch${keys > 1 ? "es" : ""}, one per key. Print the housing upright and the keycaps standing on their open side, with no supports. Push each switch into a socket from the top until it clicks, then press a keycap onto each stem.`,
  ];
  if (letters.length < keys) warnings.push("One letter, emoji, or logo could not be drawn. Try another font or add it again.");
  return pack(letters.length ? fuse(letters) : new THREE.BufferGeometry(), fuse(bodies), warnings);
}

const LOOP_SINK = 0.5;

// Where the keyring loop joins the outline: the middle of its end facing the chosen side,
// back corner, or dragged direction.
function loopAnchor(settings: ProductSettings, outline: Pt[]) {
  const side = settings.loopSide === "right" ? 1 : -1;
  const angle = settings.loopAngle;
  const direction =
    angle !== null && angle !== undefined
      ? { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) }
      : settings.loopStyle === "corner"
        ? { x: side * Math.SQRT1_2, y: Math.SQRT1_2 }
        : { x: side, y: 0 };
  const reach = (point: Pt) => point.x * direction.x + point.y * direction.y;
  const farthest = Math.max(...outline.map(reach));
  const end = outline.filter((point) => reach(point) > farthest - 0.5);
  const anchor = {
    x: end.reduce((sum, point) => sum + point.x, 0) / end.length,
    y: end.reduce((sum, point) => sum + point.y, 0) / end.length,
  };
  return { anchor, direction };
}

function placedLoop(settings: ProductSettings, outline: Pt[], holeRadius: number, fine: number) {
  const style = settings.loopStyle === "corner" ? "tab" : settings.loopStyle;
  const { anchor, direction } = loopAnchor(settings, outline);
  return clickerLoop(style, holeRadius, fine).map((part) =>
    part
      .rotateZ(Math.atan2(direction.y, direction.x) - Math.PI)
      .translate(anchor.x - direction.x * LOOP_SINK, anchor.y - direction.y * LOOP_SINK, 0),
  );
}

// Base top just above the switch's top housing (6.6 mm over the plate), so the lid and
// the caps pressed flat on it clear the switch.
const PART_BASE_WALL = 6.9;

function partsClicker(settings: ProductSettings, quality: MeshQuality) {
  const layout = partsLayout(settings.housingLogo, settings.housingParts, settings.housingSize, settings.partCaps);
  if (!layout) throw new Error("That image is no longer loaded. Upload it again.");
  if (layout.error) throw new Error(layout.error);
  const k = CLICKER;
  const fine = quality === "print" ? 40 : 20;
  const corner = quality === "print" ? 10 : 6;
  const spacing = quality === "print" ? 0.3 : 0.5;
  const pattern = settings.surface;
  const holeRadius = clamp(settings.holeDiameter, 3, 6) / 2;
  const bodies: THREE.BufferGeometry[] = [
    clickerHousing(layout, corner, pattern, spacing, PART_BASE_WALL, { recess: layout.recess, height: PART.lid }),
    ...placedLoop(settings, layout.outline, holeRadius, fine),
  ];
  const palette: string[] = [];
  const colored: { geometry: THREE.BufferGeometry; slot: number }[] = [];
  const paint = (geometry: THREE.BufferGeometry, color: string) => {
    if (!palette.includes(color)) palette.push(color);
    colored.push({ geometry, slot: palette.indexOf(color) });
  };

  // Lid beside the base, its picture colors inlaid on top.
  const box = bounds(layout.outline);
  const lidX = box.maxX - box.minX + 8;
  const lidBody = PART.lid - PART.inlay;
  if (layout.lid.length) bodies.push(extrudeShapes(polygonShapes(layout.lid), lidBody, fine).translate(lidX, 0, 0));
  for (const inlay of layout.lid.length ? layout.inlays : []) {
    paint(extrudeShapes(polygonShapes(inlay.polygons), PART.inlay + FUSE, fine).translate(lidX, 0, lidBody - FUSE), inlay.color);
  }

  // Caps printed top face down beside each other, in front of the base. Built assembled
  // (stem post down), then flipped, which also mirrors them the right way for printing.
  const postLength = k.socket + 0.3;
  let capX = box.minX;
  layout.keys.forEach((key, index) => {
    const at = layout.positions[index];
    const local = (polygons: Polygon[]) =>
      polygonShapes(polygons.map((polygon) => polygon.map((ring) => ring.map((point) => ({ x: point.x - at.x, y: point.y - at.y })))));
    const capBody = PART.slab - PART.inlay;
    const slab = extrudeShapes(local([key.cap]), capBody, fine);
    slab.translate(0, 0, postLength);
    const post = disk(k.post);
    post.holes.push(crossPath(k.crossLength, k.crossWidth));
    const cap = fuse([slab, extrudeShapes([post], postLength + 0.3, fine)]);
    const tops = [...key.inlays, ...(key.border.length ? [{ color: settings.baseColor, polygons: key.border }] : [])].map((inlay) => ({
      geometry: extrudeShapes(local(inlay.polygons), PART.inlay + FUSE, fine).translate(0, 0, postLength + capBody - FUSE),
      color: inlay.color,
    }));
    const placed = [cap, ...tops.map((top) => top.geometry)];
    // The preview shows the picture up, as assembled; the print file lays it face down.
    if (quality === "print") for (const geometry of placed) geometry.rotateX(Math.PI).translate(0, 0, postLength + PART.slab);
    cap.computeBoundingBox();
    const capBox = cap.boundingBox!.clone();
    for (const geometry of placed) geometry.translate(capX - capBox.min.x, box.minY - 6 - capBox.max.y, 0);
    capX += capBox.max.x - capBox.min.x + 4;
    paint(cap, settings.baseColor);
    for (const top of tops) paint(top.geometry, top.color);
  });

  const pieces = colored.map(({ geometry }) => (geometry.index ? geometry.toNonIndexed() : geometry));
  const text = mergeGeometries(pieces, true);
  if (!text) throw new Error("Could not combine the colored parts.");
  text.groups.forEach((group, index) => {
    group.materialIndex = colored[index].slot;
  });
  text.userData.lineSlots = true;
  text.userData.slotColors = palette;
  const warnings = [
    layout.lid.length
      ? `Needs ${layout.keys.length} Cherry MX-compatible switch${layout.keys.length > 1 ? "es" : ""}. Print the base, the lid (colors up), and the caps (the download lays them top face down) with no supports. Push each switch into the base, glue the lid into the rim, then press each cap onto its stem through its hole.`
      : "Needs 1 Cherry MX-compatible switch. The download lays the cap picture face down, so print the base and the cap with no supports. Push the switch into the base, then press the cap onto its stem inside the rim.",
  ];
  return pack(text, fuse(bodies), warnings);
}

// Position-only copy with fresh normals, so solids and extruded parts merge together.
function plainGeometry(positions: Float32Array) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Inside any of these outlines (even-odd), in the same units.
function insidePolygons(polygons: { x: number; y: number }[][] | [number, number][][], x: number, y: number) {
  let inside = false;
  for (const ring of polygons) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const a = ring[index];
      const b = ring[previous];
      const [ax, ay] = Array.isArray(a) ? a : [a.x, a.y];
      const [bx, by] = Array.isArray(b) ? b : [b.x, b.y];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
  }
  return inside;
}

// An uploaded model cut in two along a plane that can tilt any way: the top is the cap and
// the bottom the housing, with a switch hidden inside and housing-colored bands on both
// sides of the cut. The work happens turned so the cut is flat; pieces over the cut that
// aren't picked for the cap stay on the housing.
function modelClicker(settings: ProductSettings, quality: MeshQuality) {
  ensureSampleModel();
  const id = settings.modelId || SAMPLE_MODEL;
  const model = importedModel(id);
  if (!model) throw new Error("That 3D model is no longer loaded. Upload it again.");
  const tilt = settings.modelCutTilt ?? 0;
  const turn = settings.modelCutTurn ?? 0;
  const tilted = isTiltedCut(tilt);
  const cutId = cutFrameModel(id, tilt, turn);
  let plan = clickerPlan(cutId, settings.housingSize, settings.modelCut, settings.modelSwitch);
  const { scale, cut, plate } = plan;
  // The turn from the upload's model units to the flat cut's, and mm per upload unit.
  const frame = plan.model.frame;
  const unit = scale * plan.model.factor;
  const toCut = (x: number, y: number, z: number) => {
    const point = new THREE.Vector3(x, y, z);
    if (frame) point.applyMatrix4(frame);
    return point.multiplyScalar(scale);
  };
  const fromCutUnits = frame ? frame.clone().invert() : new THREE.Matrix4();
  const { Manifold } = manifoldKernel();
  const k = CLICKER;
  const preview = quality === "preview";
  const fine = preview ? 24 : 48;
  const holeRadius = clamp(settings.holeDiameter, 3, 6) / 2;
  const throughObject = settings.loopStyle === "object";
  const warnings: string[] = [];
  if (model.repair?.kind === "welded") {
    warnings.push("Your model had small gaps, doubled walls, or loose bits, so it was repaired automatically.");
  } else if (model.repair?.kind === "rebuilt") {
    warnings.push(
      `Your model had holes in its surface, so it was rebuilt as a solid with about ${(model.repair.detail * unit).toFixed(1)} mm detail. Very fine details may be softened.`,
    );
  }
  const temps: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(item: T) => {
    temps.push(item);
    return item;
  };
  try {
    let solid = modelSolid(id, model.positions, preview);
    // The switch and its hollows span these heights (mm over the flat cut's bottom); a ring
    // hole there would break into them.
    const busy: [number, number] = [plate - k.plate - k.below - 1, cut + CUT.ceiling + CUT.capWall + 1];
    let spot: { u: number; v: number } | null = null;
    let tunnel: Tunnel | null = null;
    const curved = settings.modelHoleShape !== "straight";
    // The curved tunnel's radius: its tube plus a bridge of material over it.
    const ring = holeRadius + 4.4;
    if (throughObject) {
      const radius = holeRadius / unit;
      // Upright, the switch's heights are the upload's; tilted, any spot may cross them.
      const avoid: [number, number] = tilted ? [-Infinity, -Infinity] : [busy[0] / unit, busy[1] / unit];
      const auto = autoHole(model, (holeRadius + (curved ? 2.4 : 1.6)) / unit, avoid);
      spot = settings.modelHole ? { u: settings.modelHole.x, v: settings.modelHole.y } : auto;
      if (!settings.modelHole && !auto.fits) {
        warnings.push("The object is thin everywhere, so the ring hole has little material around it. Make it bigger or use a loop on the housing.");
      }
      const onSide = (u: number, v: number): [number, number, number] =>
        model.side.axis === "x" ? [0, u, v] : [u, 0, v];
      let samples: [number, number, number][] = [onSide(spot.u, spot.v)];
      if (curved) {
        tunnel = {
          axis: model.side.axis,
          u: spot.u,
          v: spot.v,
          ring: ring / unit,
          tilt: settings.modelHoleTilt,
          turn: settings.modelHoleTurn,
        };
        tunnel.depth = tunnelDepth(model, tunnel, (holeRadius + 2.4) / unit);
        const reach = tunnelReach(model, tunnel);
        const path = tunnel;
        samples = Array.from({ length: 24 }, (_, step) => tunnelPoint(path, (step / 24) * Math.PI * 2));
        if (reach.share > 0.97) {
          warnings.push("The curved hole is buried inside the object, so it never comes out. Drag it to an edge or change its direction.");
        } else if (reach.share < 0.15) {
          warnings.push("The curved hole is mostly outside the object, so there's little bridge to hang from. Drag it further in or change its direction.");
        }
      }
      const heights = samples.map(([x, y, z]) => toCut(x, y, z).z);
      if (Math.max(...heights) + holeRadius > busy[0] && Math.min(...heights) - holeRadius < busy[1]) {
        warnings.push("The ring hole runs into the switch inside. Drag it higher or lower.");
      }
      solid = drilled(
        `${id}:${preview}`,
        solid,
        tunnel ? { ...tunnel, radius } : { axis: model.side.axis, u: spot.u, v: spot.v, radius },
        1000,
      );
    }
    const drilledSolid = solid;
    const turned = frame ? keep(solid.transform(frame.elements as Parameters<Solid["transform"]>[0])) : solid;
    const body = keep(turned.scale(scale));

    // Every piece over the cut; the cap takes the picked ones (or the biggest), and the
    // rest stay on the housing.
    const top = keep(body.trimByPlane([0, 0, 1], cut));
    const pieces = top.decompose().map(keep);
    // How much of a piece is within `reach` mm of a point.
    const overlap = (part: Solid, point: THREE.Vector3, reach: number) => {
      const probe = Manifold.cube([reach * 2, reach * 2, reach * 2], true).translate(point.x, point.y, point.z);
      const common = part.intersect(probe);
      const volume = common.volume();
      common.delete();
      probe.delete();
      return volume;
    };
    let capPieces = pieces;
    if (pieces.length > 1) {
      const picked = new Set<Solid>();
      for (const point of settings.modelCutParts ?? []) {
        const near = toCut(point.x, point.y, point.z);
        let best: Solid | null = null;
        let most = 1e-6;
        for (const piece of pieces) {
          const volume = overlap(piece, near, 1);
          if (volume > most) {
            most = volume;
            best = piece;
          }
        }
        if (best) picked.add(best);
      }
      capPieces = picked.size
        ? pieces.filter((piece) => picked.has(piece))
        : [pieces.reduce((a, b) => (b.volume() > a.volume() ? b : a))];
    }
    const split = capPieces.length < pieces.length;
    const capTop = split ? keep(Manifold.union(capPieces)) : top;
    const kept = split ? keep(Manifold.union(pieces.filter((piece) => !capPieces.includes(piece)))) : null;
    const face = split ? keep(capTop.slice(cut + 0.02)) : null;
    if (face) {
      const outline = face.toPolygons();
      plan = clickerPlan(cutId, settings.housingSize, settings.modelCut, settings.modelSwitch, (x, y) => insidePolygons(outline, x, y));
    }
    if (capPieces.length > 1) {
      warnings.push("Some of the cap's pieces aren't joined to the one over the switch, so they print loose. Glue them on, or pick just one piece.");
    }
    const { at } = plan;
    const box = (width: number, depth: number, height: number, z: number) =>
      keep(Manifold.cube([width, depth, height], true).translate(at.x, at.y, z + height / 2));

    // The pocket fits inside every slice from the plate up to the cut, a wall in from the surface.
    let region = keep(body.slice(cut - 0.05));
    for (let step = 0; step < 5; step += 1) {
      region = keep(region.intersect(keep(body.slice(plate + 0.05 + ((cut - plate - 0.1) * step) / 5))));
    }
    // Only under the cap's own pieces.
    if (face) region = keep(region.intersect(face));
    const inner = keep(region.offset(-CUT.wall, "Round", 2, fine));
    const plug = keep(inner.offset(-CUT.gap, "Round", 2, fine));

    const bottom = keep(body.trimByPlane([0, 0, -1], -cut));
    const housing = keep(
      Manifold.difference([
        kept ? keep(Manifold.union([bottom, kept])) : bottom,
        keep(inner.extrude(cut - plate + 1).translate(0, 0, plate)),
        box(k.cutout, k.cutout, k.plate + 0.02, plate - k.plate - 0.01),
        box(k.cavity, k.cavity, k.below + 0.01, plate - k.plate - k.below),
      ]),
    );
    // The cap's hollow clears the switch top as it presses down; the socket post hangs in it.
    const postBottom = cut + CUT.ceiling - k.socket - 0.3;
    const crossBar = (width: number, depth: number) =>
      keep(Manifold.cube([width, depth, k.socket + 0.01], true).translate(at.x, at.y, postBottom - 0.01 + (k.socket + 0.01) / 2));
    const shell = keep(
      Manifold.difference([
        keep(Manifold.union([capTop, keep(plug.extrude(CUT.plug + 0.01).translate(0, 0, cut - CUT.plug))])),
        box(CUT.hollow, CUT.hollow, CUT.ceiling + CUT.plug + 0.01, cut - CUT.plug - 0.01),
      ]),
    );
    const post = keep(Manifold.cylinder(k.socket + 0.31, k.post, k.post, fine).translate(at.x, at.y, postBottom));
    const cap = keep(
      Manifold.difference([keep(Manifold.union([shell, post])), crossBar(k.crossLength, k.crossWidth), crossBar(k.crossWidth, k.crossLength)]),
    );
    if (housing.isEmpty() || cap.isEmpty()) throw new Error("Could not cut that model. Try another cut height.");

    // Below and above a height, for the housing-colored bands.
    const below = (part: Solid, z: number) => keep(part.trimByPlane([0, 0, -1], -z));
    const above = (part: Solid, z: number) => keep(part.trimByPlane([0, 0, 1], z));
    const housingBox = housing.boundingBox();
    const capBox = cap.boundingBox();
    // From the flat cut's mm back to the upload upright in mm.
    const toEditor = new THREE.Matrix4()
      .makeScale(1 / scale, 1 / scale, 1 / scale)
      .premultiply(fromCutUnits)
      .premultiply(new THREE.Matrix4().makeScale(unit, unit, unit));
    // Side by side on the bed, the cap on its plug with the cut flat. A tilted cut's preview
    // keeps the housing in the model's pose, resting on its lowest point; the download lays
    // it with the cut flat too.
    const upright = preview && frame ? toEditor : null;
    const housingMove = new THREE.Vector3();
    const capMove = new THREE.Vector3(housingBox.max[0] + 6 - capBox.min[0], 0, -(cut - CUT.plug));
    if (upright) {
      const housingUp = keep(housing.transform(upright.elements as Parameters<Solid["transform"]>[0])).boundingBox();
      housingMove.set(0, 0, -housingUp.min[2]);
      capMove.set(
        housingUp.max[0] + 6 - capBox.min[0],
        (housingUp.min[1] + housingUp.max[1]) / 2 - (capBox.min[1] + capBox.max[1]) / 2,
        -(cut - CUT.plug),
      );
    }
    const show = (geometry: THREE.BufferGeometry, onCap: boolean) => {
      if (upright && !onCap) geometry.applyMatrix4(upright);
      const move = onCap ? capMove : housingMove;
      return geometry.translate(move.x, move.y, move.z);
    };
    const place = (part: Solid, onCap: boolean) => show(plainGeometry(solidPositions(part)), onCap);
    const housingBody = [place(below(housing, cut - CUT.rim), false)];
    // Pieces left on the housing over the cut keep the object's color; only the band at the
    // cut takes the border's.
    const housingRim = [place(kept ? below(above(housing, cut - CUT.rim), cut) : above(housing, cut - CUT.rim), false)];
    if (kept) housingBody.push(place(above(housing, cut), false));
    const capBody = [place(above(cap, cut + CUT.border), true)];
    const capBorder = [place(below(cap, cut + CUT.border), true)];
    // Where the keyring loop is grabbed and which way it's dragged around, in the flat cut's mm.
    let loopGrab: { center: THREE.Vector3; reach: number; middle: THREE.Vector3 } | null = null;
    if (!throughObject && settings.loopStyle !== "none") {
      const outline = bottomOutline(plan);
      if (outline.length >= 3) {
        const loops = placedLoop(settings, outline, holeRadius, fine);
        const loopBox = new THREE.Box3();
        for (const loop of loops) {
          loop.computeBoundingBox();
          loopBox.union(loop.boundingBox!);
        }
        const ends = bounds(outline);
        loopGrab = {
          center: loopBox.getCenter(new THREE.Vector3()),
          reach: loopBox.getSize(new THREE.Vector3()).length() / 2 + 1,
          middle: new THREE.Vector3((ends.minX + ends.maxX) / 2, (ends.minY + ends.maxY) / 2, 0),
        };
        for (const loop of loops) {
          const flat = loop.index ? loop.toNonIndexed() : loop;
          housingBody.push(show(plainGeometry(Float32Array.from(flat.getAttribute("position").array)), false));
          flat.dispose();
          loop.dispose();
        }
      }
    }
    const copy = (parts: THREE.BufferGeometry[]) => fuse(parts.map((part) => part.clone()));
    const apart = preview
      ? { housing: { text: copy(housingBody), base: copy(housingRim) }, cap: { text: copy(capBody), base: copy(capBorder) } }
      : null;
    const text = fuse([...housingBody, ...capBody]);
    const base = fuse([...housingRim, ...capBorder]);

    // Where the hole is grabbed: a straight bore's axis, or the middle of a curved tunnel.
    const [holeX, holeY, holeZ] = tunnel
      ? tunnelPoint(tunnel, Infinity)
      : spot
        ? model.side.axis === "x"
          ? [0, spot.u, spot.v]
          : [spot.u, 0, spot.v]
        : [0, 0, 0];
    const holeAt = toCut(holeX, holeY, holeZ);
    // Over the cut, the hole is on the cap unless it's in a piece left on the housing.
    const holeReach = curved ? ring + holeRadius : holeRadius + 1;
    const holeOnCap =
      spot !== null && holeAt.z > cut && (!kept || overlap(capTop, holeAt, holeReach) >= overlap(kept, holeAt, holeReach));
    warnings.push(
      `Needs 1 Cherry MX-compatible switch. Print the housing on its bottom and the cap on its plug, with supports under any overhangs.${tilted ? " The cut is tilted: the preview keeps the model's pose, but the download lays both parts with the cut flat; turn on supports, or turn the housing in your slicer if its bottom isn't flat." : ""} Push the switch into the housing's pocket, then press the cap's socket onto the stem: the cap rests ${CUT.travel} mm up and clicks down to meet the housing.${holeOnCap ? " The keyring pulls on the cap, so glue the cap onto the stem." : ""}`,
    );
    text.computeBoundingBox();
    base.computeBoundingBox();
    const all = text.boundingBox!.clone().union(base.boundingBox!);
    const packed = pack(text, base, warnings);
    const cx = (all.min.x + all.max.x) / 2;
    const cy = (all.min.y + all.max.y) / 2;
    if (spot) {
      const holeShown = holeAt.clone();
      if (upright && !holeOnCap) holeShown.applyMatrix4(upright);
      holeShown.add(holeOnCap ? capMove : housingMove);
      // A curved tunnel is grabbed anywhere around its ring.
      packed.hole = {
        x: holeShown.x - cx,
        y: holeShown.y - cy,
        z: holeShown.z - all.min.z,
        radius: curved ? ring + holeRadius : holeRadius,
        axis: model.side.axis,
        unit,
        u: spot.u,
        v: spot.v,
      };
      if (frame && (!upright || holeOnCap)) {
        // The frame's turn without its scale, transposed: shown directions back to the upload's.
        const turnBack = new THREE.Matrix3().setFromMatrix4(frame).multiplyScalar(1 / plan.model.factor);
        packed.hole.basis = Array.from(turnBack.elements);
      }
    }
    if (preview && loopGrab) {
      const shown = (point: THREE.Vector3) => {
        const out = point.clone();
        if (upright) out.applyMatrix4(upright);
        return out.add(housingMove).sub(new THREE.Vector3(cx, cy, all.min.z)).toArray();
      };
      const turnOnly = upright ? new THREE.Matrix3().setFromMatrix4(upright) : new THREE.Matrix3();
      const along = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix3(turnOnly).normalize().toArray();
      packed.loop = {
        center: shown(loopGrab.center),
        reach: loopGrab.reach,
        middle: shown(loopGrab.middle),
        normal: along(0, 0, 1),
        u: along(1, 0, 0),
        v: along(0, 1, 0),
      };
    }
    if (preview) {
      const editorPoint = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(toEditor);
      const source = plainGeometry(solidPositions(drilledSolid));
      source.scale(unit, unit, unit);
      const normal = cutNormal(tilt, turn);
      const point = editorPoint(0, 0, cut);
      const editor: ModelCutEditor = {
        source,
        normal: [normal.x, normal.y, normal.z],
        point: [point.x, point.y, point.z],
        tilt,
        turn,
        unit,
        pieces: pieces.map((piece) => {
          const positions = solidPositions(piece);
          let topmost = 2;
          for (let index = 5; index < positions.length; index += 3) if (positions[index] > positions[topmost]) topmost = index;
          const at = new THREE.Vector3(positions[topmost - 2], positions[topmost - 1], positions[topmost])
            .multiplyScalar(1 / scale)
            .applyMatrix4(fromCutUnits);
          const geometry = plainGeometry(positions);
          geometry.applyMatrix4(toEditor);
          geometry.computeVertexNormals();
          const section = keep(piece.slice(cut + 0.02));
          const outline = section.toPolygons().map((ring) => {
            const flat = new Float32Array(ring.length * 3);
            ring.forEach(([x, y], index) => {
              const shown = editorPoint(x, y, cut + 0.02);
              flat.set([shown.x, shown.y, shown.z], index * 3);
            });
            return flat;
          });
          return { geometry, cap: capPieces.includes(piece), at: { x: at.x, y: at.y, z: at.z }, outline };
        }),
      };
      packed.cutEditor = editor;
    }
    if (apart) {
      for (const geometry of [apart.housing.text, apart.housing.base, apart.cap.text, apart.cap.base]) {
        geometry.translate(-cx, -cy, -all.min.z);
      }
      // Dragged up and down, the cut only makes sense where it's shown flat.
      if (!upright) {
        packed.cut = { z: cut - all.min.z, minX: housingBox.min[0] - cx, maxX: housingBox.max[0] - cx, mm: cut, height: plan.height };
      }
      // Assembled, the switch holds the cap up by the travel gap; a full press closes all but 0.3 mm.
      // A tilted cut's cap also turns from lying on its plug to the housing's pose.
      const axis = upright ? cutNormal(tilt, turn) : new THREE.Vector3(0, 0, 1);
      const shift = new THREE.Vector3(cx, cy, all.min.z);
      const onHousing = new THREE.Matrix4()
        .makeTranslation(-shift.x, -shift.y, -shift.z)
        .multiply(new THREE.Matrix4().makeTranslation(housingMove.x, housingMove.y, housingMove.z))
        .multiply(upright ?? new THREE.Matrix4())
        .multiply(new THREE.Matrix4().makeTranslation(-capMove.x, -capMove.y, -capMove.z))
        .multiply(new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z));
      apart.cap.text.computeBoundingBox();
      const pivot = apart.cap.text.boundingBox!.getCenter(new THREE.Vector3());
      const offset = pivot.clone().applyMatrix4(onHousing).sub(pivot).addScaledVector(axis, CUT.travel);
      const spin = new THREE.Quaternion().setFromRotationMatrix(onHousing);
      packed.assembly = {
        ...apart,
        offset: { x: offset.x, y: offset.y, z: offset.z },
        axis: { x: axis.x, y: axis.y, z: axis.z },
        pivot: { x: pivot.x, y: pivot.y, z: pivot.z },
        turn: upright ? [spin.x, spin.y, spin.z, spin.w] : undefined,
        press: 4,
      };
    }
    return packed;
  } finally {
    for (const item of temps) item.delete();
  }
}

function polygonShapes(polygons: Polygon[]) {
  return polygons
    .filter((polygon) => polygon[0]?.length >= 3)
    .map((polygon) => {
      const shape = new THREE.Shape(polygon[0].map((point) => new THREE.Vector2(point.x, point.y)));
      shape.holes = polygon.slice(1).map((ring) => new THREE.Path(ring.map((point) => new THREE.Vector2(point.x, point.y))));
      return shape;
    });
}

// Keyring loop off a housing end at x = 0 that faces -x, lying flat on the bed.
function clickerLoop(style: LoopStyle, hole: number, fine: number) {
  const depth = 5;
  const solid = (shapes: THREE.Shape[]) => extrudeShapes(shapes, depth, fine);
  const bore = (x: number, y: number) => {
    const path = new THREE.Path();
    path.absarc(x, y, hole, 0, Math.PI * 2, true);
    return path;
  };
  const neck = (from: number, width: number) => {
    const bar = solid([roundedRect(2 - from, width, 0.8)]);
    return bar.translate((from + 2) / 2, 0, 0);
  };
  switch (style) {
    case "none":
      return [];
    case "ring": {
      const outer = hole + 2;
      const center = -(hole + outer + 2);
      return [solid([ring(outer, hole)]).translate(center, 0, 0), neck(center + hole + 0.6, 4)];
    }
    case "heart": {
      const scale = (hole + 2.2) / 7;
      const heart = new THREE.Shape();
      for (let step = 0; step <= 96; step += 1) {
        const t = (step / 96) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3 * scale;
        const y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * scale;
        if (step === 0) heart.moveTo(x, y);
        else heart.lineTo(x, y);
      }
      heart.holes.push(bore(0, -3 * scale));
      // Tip toward the housing, sunk 3 mm into its end wall.
      return [solid([heart]).rotateZ(Math.PI / 2).translate(3 - 17 * scale, 0, 0)];
    }
    case "star": {
      const inner = hole + 2.2;
      const outer = inner * 1.85;
      const star = new THREE.Shape();
      for (let point = 0; point < 10; point += 1) {
        const angle = Math.PI + (point * Math.PI) / 5;
        const radius = point % 2 ? inner : outer;
        if (point === 0) star.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      star.holes.push(bore(0, 0));
      const center = -(outer * 0.8 + 1);
      return [solid([star]).translate(center, 0, 0), neck(center + hole + 0.6, 4)];
    }
    default: {
      const tab = solid([noseBar(hole + 4, hole + 2.5, hole)]);
      return [tab.rotateZ(Math.PI).translate(-(hole + 2), 0, 0)];
    }
  }
}

// Logos raise their own marks (outlines or line art); emojis use the bead style.
function capIcon(id: string, target: number, depth: number) {
  if (!isLogo(id)) return flexiEmoji(id, target, depth);
  const layers = charmLayers(id, 0, 0, 1);
  if (!layers?.mark.length) return null;
  const rings = layers.mark
    .map((ring) => ring.points.map((point) => new THREE.Vector2(point.x, point.y)))
    .filter((points) => points.length >= 3);
  if (!rings.length) return null;
  // Rings come as an outer outline followed by its holes, so the outer winding marks a new shape.
  const outerSign = Math.sign(THREE.ShapeUtils.area(rings[0]));
  const shapes: THREE.Shape[] = [];
  for (const points of rings) {
    if (Math.sign(THREE.ShapeUtils.area(points)) === outerSign) shapes.push(new THREE.Shape(points));
    else shapes[shapes.length - 1]?.holes.push(new THREE.Path(points));
  }
  const mesh = extrudeShapes(shapes, depth, 1);
  mesh.computeBoundingBox();
  const box = mesh.boundingBox!;
  const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) || 1;
  mesh.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, 0);
  mesh.scale(target / span, target / span, 1);
  return mesh;
}

// Keycap standing on its open side: a skirt around the switch, a cross socket for the
// stem, and a rounded top. The socket post reaches the bed, so nothing hangs in the air.
function keycap(outline: Pt[], fine: number, corner: number, pattern: SurfacePattern, spacing: number) {
  const k = CLICKER;
  const bevel = (k.cap - k.capTop) / 2;
  const steps = 8;
  const shoulder = k.capHeight - bevel;
  const outer: { z: number; inset: number }[] = (pattern === "plain" ? [0] : levels(0, shoulder, spacing).slice(0, -1)).map(
    (z) => ({ z, inset: 0 }),
  );
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * (Math.PI / 2);
    outer.push({ z: shoulder + bevel * Math.sin(angle), inset: bevel * (1 - Math.cos(angle)) });
  }
  // Engraved into the solid band above the switch socket; the skirt below is only 1 mm.
  const low = k.socket + 0.4;
  const high = shoulder - 0.3;
  const push = (s: number, z: number, around: number) =>
    -CAP_RELIEF * patternHeight(pattern, s, z, around) * smoothstep(low, low + 0.5, z) * (1 - smoothstep(high - 0.5, high, z));
  const samples = sampleOutline(outline, spacing);
  const shell = outer.map((level) => ringAt(samples, level.z, level.inset ? () => -level.inset : push));
  const innerSize = k.cap - 2 * k.skirtWall;
  const innerBottom = squareRing(0, 0, innerSize, 1.4, corner, 0);
  const innerTop = squareRing(0, 0, innerSize, 1.4, corner, k.socket);

  const parts = [
    loft(shell, false),
    loft([innerBottom, innerTop], true),
    capFace(shell[shell.length - 1], 1),
    capFace(innerTop, -1),
    holedFace(shell[0], [innerBottom], -1),
  ];

  const post = disk(k.post);
  post.holes.push(crossPath(k.crossLength, k.crossWidth));
  parts.push(extrudeShapes([post], k.socket + 0.3, fine));
  return parts;
}

function surface(positions: number[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Side wall through a stack of rings. Shared vertices keep the rounded edge smooth.
function loft(rings: THREE.Vector3[][], inward: boolean) {
  const count = rings[0].length;
  const positions = rings.flatMap((points) => points.flatMap((point) => [point.x, point.y, point.z]));
  const indices: number[] = [];
  for (let level = 0; level < rings.length - 1; level += 1) {
    for (let index = 0; index < count; index += 1) {
      const a = level * count + index;
      const b = level * count + ((index + 1) % count);
      const c = b + count;
      const d = a + count;
      indices.push(...(inward ? [a, c, b, a, d, c] : [a, b, c, a, c, d]));
    }
  }
  return surface(positions, indices);
}

function capFace(points: THREE.Vector3[], facing: 1 | -1) {
  const contour = points.map((point) => new THREE.Vector2(point.x, point.y));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  return surface(points.flatMap((point) => [point.x, point.y, point.z]), facedUp(contour, triangles, facing));
}

function crossPath(length: number, width: number) {
  const l = length / 2;
  const w = width / 2;
  const points = [
    [w, l], [w, w], [l, w], [l, -w], [w, -w], [w, -l],
    [-w, -l], [-w, -w], [-l, -w], [-l, w], [-w, w], [-w, l],
  ];
  return new THREE.Path(points.map(([x, y]) => new THREE.Vector2(x, y)));
}

// A bar from x = -length to 0, ending in a half-round nose of radius `radius` centered at 0.
function noseBar(length: number, radius: number, bore?: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-length, -radius);
  shape.lineTo(0, -radius);
  shape.absarc(0, 0, radius, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-length, radius);
  shape.closePath();
  if (bore) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return shape;
}

function flexiLetter(font: Font, char: string, maxWidth: number, capHeight: number, depth: number, quality: MeshQuality) {
  try {
    const glyph = layoutText(font, char, capHeight, quality).glyphs[0];
    if (!glyph) return null;
    const width = Math.max(0.1, glyph.maxX - glyph.minX);
    const height = Math.max(0.1, glyph.maxY - glyph.minY);
    const scale = Math.min(1, maxWidth / width, maxWidth / height);
    const mesh = extrudeShapes(glyph.shapes, depth, 4);
    mesh.translate(-(glyph.minX + glyph.maxX) / 2, -(glyph.minY + glyph.maxY) / 2, 0);
    mesh.scale(scale, scale, 1);
    return mesh;
  } catch {
    return null;
  }
}

function flexiEmoji(id: string, target: number, depth: number) {
  // Cut at full size: tiny holes are dropped when cut shapes are rebuilt.
  const layers = charmLayers(id, 0, 0, target);
  if (!layers) return null;
  const rings = (list: { points: { x: number; y: number }[] }[]) =>
    list.map((ring) => ring.points).filter((points) => points.length >= 3);
  const shapes = layers.body.length
    ? emojiFace(rings(layers.body), rings(layers.mark), rings(layers.pupil), Math.max(0.35, target * 0.04))
    : rings(layers.mark).map((points) => new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.y))));
  if (!shapes.length) return null;
  const mesh = extrudeShapes(shapes, depth, 1);
  mesh.computeBoundingBox();
  const box = mesh.boundingBox!;
  const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) || 1;
  mesh.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, 0);
  mesh.scale(target / span, target / span, 1);
  return mesh;
}

function blockArticulated(
  layout: { glyphs: GlyphLayout[]; warnings: string[] },
  bodyDepth: number,
  capDepth: number,
  holeRadius: number,
  linkSize: number,
  letterGap: number,
) {
  const glyphs = layout.glyphs;
  const capTop = Math.max(...glyphs.map((glyph) => glyph.maxY));
  const baseLine = Math.min(...glyphs.map((glyph) => glyph.minY));
  const midY = (capTop + baseLine) / 2;
  const letterSpan = Math.max(6, capTop - baseLine);
  const cap = clamp(1.5 + capDepth * 0.9, 1.6, 3.6);
  const ringHole = Math.min(holeRadius, letterSpan * 0.16, 2.8);
  const chain = chainMetrics(linkSize, letterGap);
  const gap = chain.gap;
  let leftX = ringHole * 2 + 1.4;
  const bodies: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];

  glyphs.forEach((glyph, index) => {
    const width = Math.max(1.4, glyph.maxX - glyph.minX);
    const shift = -glyph.minX;
    const body = extrudeShapes(glyph.shapes, bodyDepth, 12);
    body.translate(shift, 0, 0);
    placePart(body, 0, midY, 0, leftX, midY);
    bodies.push(body);
    const top = extrudeShapes(glyph.shapes, cap + FUSE, 12);
    top.translate(shift, 0, bodyDepth - FUSE);
    placePart(top, 0, midY, 0, leftX, midY);
    caps.push(top);

    if (index === 0) {
      const leftStroke = outlineExtreme(glyph, midY, "min") + shift;
      const leftTenon = letterBridge(0, Math.max(leftStroke, 0) + 1.4, midY, 3.2, bodyDepth);
      if (leftTenon) {
        placePart(leftTenon, 0, midY, 0, leftX, midY);
        bodies.push(leftTenon);
      }
    }

    if (index < glyphs.length - 1) {
      const next = glyphs[index + 1];
      const embedLeft = Math.max(0, glyph.maxX - outlineExtreme(glyph, midY, "max")) + 3.6;
      const embedRight = Math.max(0, outlineExtreme(next, midY, "min") - next.minX) + 3.6;
      const jointX = leftX + width + gap / 2;
      for (const part of chainLinks(bodyDepth + cap, chain, embedLeft, embedRight)) {
        placePart(part, 0, 0, 0, jointX, midY);
        bodies.push(part);
      }
      leftX += width + gap;
    }
  });

  const tab = extrudeShapes([ring(ringHole + 1.6, ringHole)], bodyDepth, ROUND);
  tab.translate(-ringHole - 0.55, midY, 0);
  placePart(tab, 0, midY, 0, ringHole * 2 + 1.4, midY);
  bodies.push(tab);

  return pack(fuse(caps), fuse(bodies), [
    ...layout.warnings,
    "Print it flat. A bar passes through a round hole, with clearance so each letter can pivot.",
  ]);
}

type ChainMetrics = {
  holeR: number;
  axleR: number;
  headR: number;
  baseX: number;
  rightFace: number;
  apexX: number;
  half: number;
  cornerR: number;
  tipR: number;
  plateT: number;
  barH: number;
  headT: number;
  keeperT: number;
  axial: number;
  gap: number;
  shift: number;
};

function chainMetrics(size: number, distance = 0): ChainMetrics {
  const height = clamp(size, 5, 14);
  const holeR = clamp(height * 0.22, 1.35, 2.6);
  const axleR = holeR - 0.4;
  const headR = holeR + 0.55;
  const plateT = 1.15;
  const axial = 0.35;
  const barH = axleR * 1.15;
  const headT = Math.max(1.45, holeR * 0.9);
  const keeperT = 0.75;
  const extra = clamp(distance, 0, 24);
  const visibleBar = holeR + 1.85;
  const rightFace = holeR + 1.55;
  const leftFace = -(visibleBar + extra);
  const baseX = -(holeR + 1.05);
  const apexX = rightFace + 3.6;
  const span = apexX - baseX;
  const half = ((holeR + 1.0) * span) / apexX;
  return {
    holeR,
    axleR,
    headR,
    baseX,
    rightFace,
    apexX,
    half,
    cornerR: Math.max(0.75, holeR * 0.45),
    tipR: Math.max(1.7, holeR * 0.95),
    plateT,
    barH,
    headT,
    keeperT,
    axial,
    gap: rightFace - leftFace,
    shift: (leftFace + rightFace) / 2,
  };
}

function eyeShape(chain: ChainMetrics) {
  const shape = new THREE.Shape();
  roundedPoly(
    shape,
    [
      new THREE.Vector2(chain.baseX, chain.half),
      new THREE.Vector2(chain.baseX, -chain.half),
      new THREE.Vector2(chain.apexX, 0),
    ],
    [chain.cornerR, chain.cornerR, chain.tipR],
  );
  const hole = new THREE.Path();
  hole.absarc(0, 0, chain.holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function roundedPoly(shape: THREE.Shape, points: THREE.Vector2[], radii: number[]) {
  const count = points.length;
  const corners = points.map((point, index) => {
    const previous = points[(index + count - 1) % count];
    const next = points[(index + 1) % count];
    const towardPrevious = new THREE.Vector2().subVectors(previous, point);
    const towardNext = new THREE.Vector2().subVectors(next, point);
    const previousLength = towardPrevious.length();
    const nextLength = towardNext.length();
    towardPrevious.multiplyScalar(1 / previousLength);
    towardNext.multiplyScalar(1 / nextLength);
    const cut = Math.min(radii[index], previousLength * 0.45, nextLength * 0.45);
    return {
      start: point.clone().add(towardPrevious.multiplyScalar(cut)),
      end: point.clone().add(towardNext.multiplyScalar(cut)),
      at: point,
    };
  });
  shape.moveTo(corners[0].start.x, corners[0].start.y);
  for (let index = 0; index < count; index += 1) {
    const corner = corners[index];
    shape.quadraticCurveTo(corner.at.x, corner.at.y, corner.end.x, corner.end.y);
    const next = corners[(index + 1) % count];
    shape.lineTo(next.start.x, next.start.y);
  }
  shape.closePath();
}

function chainLinks(room: number, chain: ChainMetrics, embedLeft = 3.6, embedRight = 3.6) {
  const apexX = chain.rightFace + embedRight;
  const span = apexX - chain.baseX;
  const fitted = { ...chain, apexX, half: ((chain.holeR + 1) * span) / apexX };
  const plateBottom = Math.min(chain.keeperT + chain.axial, Math.max(0.8, room * 0.28));
  const plate = extrudeShapes([eyeShape(fitted)], chain.plateT, 96);
  plate.translate(0, 0, plateBottom);

  const knuckleBottom = plateBottom + chain.plateT + chain.axial;
  const knuckle = new THREE.CylinderGeometry(chain.axleR, chain.axleR, chain.headT, 64);
  knuckle.rotateX(Math.PI / 2);
  knuckle.translate(0, 0, knuckleBottom + chain.headT / 2);

  const barLeft = chain.shift - chain.gap / 2 - embedLeft;
  const barDrop = (chain.axleR - chain.barH / 2) * 0.45;
  const bar = new THREE.BoxGeometry(chain.axleR * 0.15 - barLeft, chain.barH, chain.headT);
  bar.translate((barLeft + chain.axleR * 0.15) / 2, -barDrop, knuckleBottom + chain.headT / 2);

  const keeper = new THREE.CylinderGeometry(chain.headR, chain.headR, chain.keeperT, 64);
  keeper.rotateX(Math.PI / 2);
  keeper.translate(0, 0, chain.keeperT / 2);

  const axleBottom = chain.keeperT * 0.35;
  const axleTop = knuckleBottom + chain.headT * 0.6;
  const axle = new THREE.CylinderGeometry(chain.axleR, chain.axleR, axleTop - axleBottom, 64);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, 0, (axleBottom + axleTop) / 2);

  for (const part of [plate, knuckle, bar, keeper, axle]) part.translate(-chain.shift, 0, 0);
  return [plate, bar, knuckle, keeper, axle];
}

function placePart(
  geometry: THREE.BufferGeometry,
  pivotX: number,
  pivotY: number,
  angle: number,
  worldX: number,
  worldY: number,
) {
  geometry.translate(-pivotX, -pivotY, 0);
  if (Math.abs(angle) > 1e-6) geometry.rotateZ(angle);
  geometry.translate(worldX, worldY, 0);
}

function outlineExtreme(glyph: GlyphLayout, y: number, side: "min" | "max") {
  let best = side === "max" ? -Infinity : Infinity;
  let found = false;
  for (const shape of glyph.shapes) {
    const points = shape.getPoints(4);
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const dy = end.y - start.y;
      if (Math.abs(dy) < 1e-6) {
        if (Math.abs(start.y - y) > 0.35) continue;
        const x = side === "max" ? Math.max(start.x, end.x) : Math.min(start.x, end.x);
        best = side === "max" ? Math.max(best, x) : Math.min(best, x);
        found = true;
        continue;
      }
      const t = (y - start.y) / dy;
      if (t < -0.02 || t > 1.02) continue;
      const x = start.x + t * (end.x - start.x);
      best = side === "max" ? Math.max(best, x) : Math.min(best, x);
      found = true;
    }
  }
  if (!found) return side === "max" ? glyph.maxX : glyph.minX;
  return best;
}

function letterBridge(fromX: number, toX: number, y: number, height: number, depth: number) {
  const left = Math.min(fromX, toX);
  const right = Math.max(fromX, toX);
  if (right - left < 0.2) return null;
  const shape = new THREE.Shape();
  const bottom = y - height / 2;
  shape.moveTo(left, bottom);
  shape.lineTo(right, bottom);
  shape.lineTo(right, bottom + height);
  shape.lineTo(left, bottom + height);
  shape.closePath();
  return extrudeShapes([shape], depth, 1);
}

function penHolder(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const depth = clamp(settings.textThickness, 10, 28);
  let height = clamp(settings.letterHeight, 24, 60);
  const limit = clamp(settings.maxLength, 60, 220);
  let layout = layoutText(font, settings.text, height, quality);
  let bounds = boundsOf(layout.glyphs);
  while (bounds.maxX - bounds.minX > limit && height > 16) {
    height = Math.round((height * 0.92) * 10) / 10;
    layout = layoutText(font, settings.text, height, quality);
    bounds = boundsOf(layout.glyphs);
  }
  const letters = extrudeShapes(layout.shapes, depth, 1);
  const plateDepth = depth + 6;
  const plate = extrudeShapes(
    [roundedRect(bounds.maxX - bounds.minX + 16, 8, 2)],
    plateDepth,
    2,
  );
  plate.translate((bounds.minX + bounds.maxX) / 2, bounds.minY - 3.2, (plateDepth - depth) / 2);
  turnUpright(letters);
  turnUpright(plate);
  const sockets = layout.glyphs.map((glyph) => {
    const socket = tube(4.2, 3.1, 12, curve);
    socket.translate((glyph.minX + glyph.maxX) / 2, -depth / 2, glyph.maxY - 1);
    return socket;
  });
  return pack(letters, fuse([plate, ...sockets]), [
    ...layout.warnings,
    height < settings.letterHeight ? "Letter height was reduced to fit the maximum length." : "",
  ].filter(Boolean));
}

function pictureFrame(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const photoW = clamp(settings.photoWidth, 50, 200);
  const photoH = clamp(settings.photoHeight, 50, 260);
  const border = 14;
  const thickness = clamp(settings.baseThickness, 4, 12);
  const outerW = photoW + border * 2;
  const outerH = photoH + border * 2;
  const frame = extrudeShapes([frameShape(outerW, outerH, photoW, photoH)], thickness, 1);
  const layout = layoutText(font, settings.text, settings.letterHeight, quality, { maxChars: 12 });
  const bounds = boundsOf(layout.glyphs);
  const letters = extrudeShapes(layout.shapes, settings.textThickness + FUSE, 1);
  letters.translate(
    -(bounds.minX + bounds.maxX) / 2,
    -(bounds.minY + bounds.maxY) / 2,
    thickness - FUSE,
  );
  letters.rotateZ(-Math.PI / 2);
  const textHeight = bounds.maxX - bounds.minX;
  const fit = Math.min(1, (photoH - 8) / Math.max(textHeight, 1));
  letters.scale(fit, fit, 1);
  letters.translate(outerW / 2 - border / 2, 0, 0);
  const leg = new THREE.BoxGeometry(photoW * 0.42, 3, photoH * 0.42);
  leg.translate(0, -photoH * 0.12, photoH * 0.16);
  leg.rotateX(-0.62);
  leg.translate(0, -thickness * 0.2, -6);
  turnUpright(frame);
  turnUpright(letters);
  turnUpright(leg);
  return pack(letters, fuse([frame, leg]), [
    ...layout.warnings,
    "The opening is the photo size. The stand is part of the frame.",
  ]);
}

function nameplate(font: Font, settings: ProductSettings, quality: MeshQuality) {
  const layout = layoutText(font, settings.text, settings.letterHeight, quality);
  const bounds = boundsOf(layout.glyphs);
  const depth = clamp(settings.textThickness, 4, 16);
  const plateThickness = clamp(settings.baseThickness, 2, 8);
  const letters = extrudeShapes(layout.shapes, depth, 1);
  const plateWidth = bounds.maxX - bounds.minX + 16;
  const plate = extrudeShapes([roundedRect(plateWidth, plateThickness + 6, 1.6)], depth, 2);
  plate.translate((bounds.minX + bounds.maxX) / 2, bounds.minY - plateThickness * 0.35, 0);
  turnUpright(letters);
  turnUpright(plate);
  return pack(letters, plate, layout.warnings);
}

function planter(settings: ProductSettings, curve: number) {
  const inner = clamp(settings.innerDiameter, 40, 180) / 2;
  const height = clamp(settings.innerHeight, 30, 180);
  const wall = 2.6;
  const floorDepth = 2.8;
  const outer = inner + wall;
  const body = extrudeShapes([ring(outer, inner)], height, curve);
  body.translate(0, 0, floorDepth - FUSE);
  const floor = extrudeShapes([ring(outer, Math.max(3, inner * 0.08))], floorDepth, curve);
  const lip = extrudeShapes([ring(outer + 1.2, inner - 0.4)], 3.2, curve);
  lip.translate(0, 0, floorDepth + height - 2.4);
  const ribCount = settings.pattern === "square" ? 28 : 46;
  const ribs =
    settings.pattern === "smooth"
      ? []
      : Array.from({ length: ribCount }, (_, index) => {
          const rib = new THREE.BoxGeometry(settings.pattern === "square" ? 3.4 : 1.5, 2.4, height * 0.94);
          rib.translate(outer + 0.7, 0, floorDepth + height * 0.48);
          rib.rotateZ((index / ribCount) * Math.PI * 2);
          return rib;
        });
  return pack(lip, fuse([body, floor, ...ribs]), [
    "Sizes are the inside of the pot, in millimeters. The floor has a small drain.",
  ]);
}

function plantLabel(font: Font, settings: ProductSettings, quality: MeshQuality) {
  const layout = layoutText(font, settings.text, settings.letterHeight, quality, { maxChars: 12 });
  const bounds = boundsOf(layout.glyphs);
  const width = Math.max(28, bounds.maxX - bounds.minX + 10);
  const head = Math.max(18, bounds.maxY - bounds.minY + 8);
  const stake = new THREE.Shape();
  stake.moveTo(-5, 0);
  stake.lineTo(5, 0);
  stake.lineTo(width / 2, 78);
  stake.lineTo(width / 2, 78 + head);
  stake.lineTo(-width / 2, 78 + head);
  stake.lineTo(-width / 2, 78);
  stake.closePath();
  const body = extrudeShapes([stake], settings.baseThickness, 1);
  const letters = extrudeShapes(layout.shapes, settings.textThickness + FUSE, 1);
  letters.translate(
    -(bounds.minX + bounds.maxX) / 2,
    78 + head / 2 - (bounds.minY + bounds.maxY) / 2,
    settings.baseThickness - FUSE,
  );
  return pack(letters, body, layout.warnings);
}

function magnet(font: Font, settings: ProductSettings, _quality: MeshQuality, _curve: number) {
  const letterHeight = clamp(settings.letterHeight, 12, 48);
  const outline = clamp(settings.outline, 1.4, 6);
  const bodyDepth = clamp(settings.baseThickness, 1.8, 6);
  const letterDepth = clamp(settings.textThickness, 0.8, 3.2);
  const profile = outlinedMagnet(
    font,
    settings.text,
    letterHeight,
    outline,
    clamp(settings.magnetDiameter, 4, 18) / 2,
    settings.charms,
    settings.charmBase,
  );
  const floor = 0.8;
  const pocketDepth = profile.pocketShapes ? Math.max(0.8, bodyDepth - floor) : 0;
  const letters = extrudeShapes(profile.textShapes, letterDepth + FUSE, 2);
  letters.translate(0, 0, bodyDepth - FUSE);
  const body: THREE.BufferGeometry[] = [];
  if (profile.pocketShapes && pocketDepth > 0.4) {
    body.push(extrudeShapes(profile.pocketShapes, pocketDepth, 2));
    body.push(
      extrudeShapes(profile.baseShapes, bodyDepth - pocketDepth + FUSE, 2).translate(0, 0, pocketDepth - FUSE),
    );
  } else {
    body.push(extrudeShapes(profile.baseShapes, bodyDepth, 2));
  }
  return pack(
    letters,
    fuse(body),
    [
      ...profile.warnings,
      "The colored name sits on a white outline. The round pocket opens on the back for the magnet.",
    ],
    { anchorX: profile.centerX, anchorY: profile.centerY, charmBounds: profile.charmBounds },
  );
}

function wallArt(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const layout = layoutText(font, settings.text, settings.letterHeight, quality, { maxChars: 24 });
  const bounds = boundsOf(layout.glyphs);
  const width = bounds.maxX - bounds.minX + 18;
  const height = bounds.maxY - bounds.minY + 28;
  const plateDepth = clamp(settings.baseThickness, 2, 6);
  const plate = extrudeShapes(
    [plateWithHoles(width, height, 6, 2.2, width / 2 - 8, height / 2 - 8)],
    plateDepth,
    curve,
  );
  const letters = extrudeShapes(layout.shapes, settings.textThickness + FUSE, 1);
  letters.translate(
    -(bounds.minX + bounds.maxX) / 2,
    -(bounds.minY + bounds.maxY) / 2 - 6,
    plateDepth - FUSE,
  );
  return pack(letters, plate, [
    ...layout.warnings,
    "Two holes sit above the letters for hanging.",
  ]);
}

function glassMarker(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const layout = layoutText(font, settings.text, settings.letterHeight, quality, { maxChars: 10 });
  const bounds = boundsOf(layout.glyphs);
  const radius = clamp(settings.cableDiameter, 4, 14) / 2;
  const clip = channel(settings.baseThickness + 4, radius, 1.6, curve);
  clip.translate(bounds.minX - radius - 4, (bounds.minY + bounds.maxY) / 2, 0);
  const letters = extrudeShapes(layout.shapes, settings.textThickness, 1);
  letters.translate(0, 0, radius + 1.4);
  return pack(letters, clip, [...layout.warnings, "Hook the clip over the rim of the glass."]);
}

function headband(font: Font, settings: ProductSettings, quality: MeshQuality, curve: number) {
  const layout = layoutText(font, settings.text, settings.letterHeight, quality);
  const bounds = boundsOf(layout.glyphs);
  const radius = Math.max(62, (bounds.maxX - bounds.minX) / 1.5);
  const band = extrudeShapes([arcBand(radius, 16, Math.PI * 0.72)], settings.baseThickness, curve);
  const letters = extrudeShapes(layout.shapes, settings.textThickness + FUSE, 1);
  letters.translate(
    -(bounds.minX + bounds.maxX) / 2,
    radius + 8 - (bounds.minY + bounds.maxY) / 2,
    settings.baseThickness - FUSE,
  );
  return pack(letters, band, layout.warnings);
}

const HINGE_CURVE = 128;
const FLANGE_T = 0.75;
const AXIAL_GAP = 0.3;
const SIDE_CLEAR = 0.25;
const RADIAL_CLEAR = 0.32;

function linkJoint(
  jointX: number,
  leftEdge: number,
  rightEdge: number,
  thickness: number,
  radius: number,
) {
  const layout = hingeLayout(thickness, radius);
  const overlap = 0.7;
  return [
    knuckle(jointX, layout.z0, layout.femaleLength, radius, layout.holeRadius, rightEdge + overlap),
    knuckle(
      jointX,
      layout.maleStart + layout.maleLength + SIDE_CLEAR,
      layout.femaleLength,
      radius,
      layout.holeRadius,
      rightEdge + overlap,
    ),
    knuckle(jointX, layout.maleStart, layout.maleLength, radius * 0.94, layout.holeRadius, leftEdge - overlap),
    ...capturedPin(jointX, thickness, layout.pinRadius, layout.flangeRadius, FLANGE_T),
  ];
}

function hingeLayout(thickness: number, radius: number) {
  const z0 = FLANGE_T + AXIAL_GAP;
  const z1 = thickness - FLANGE_T - AXIAL_GAP;
  const span = Math.max(1.6, z1 - z0);
  const maleLength = Math.min(1.2, span * 0.34);
  const femaleLength = (span - maleLength - SIDE_CLEAR * 2) / 2;
  const maleStart = z0 + femaleLength + SIDE_CLEAR;
  const pinRadius = Math.min(0.95, radius * 0.38);
  const holeRadius = pinRadius + RADIAL_CLEAR;
  const flangeRadius = Math.min(radius - 0.15, holeRadius + 0.5);
  return { z0, maleLength, femaleLength, maleStart, pinRadius, holeRadius, flangeRadius };
}

function capturedPin(
  jointX: number,
  thickness: number,
  pinRadius: number,
  flangeRadius: number,
  flangeT: number,
) {
  const shaft = extrudeShapes([disk(pinRadius)], thickness, HINGE_CURVE);
  shaft.translate(jointX, 0, 0);
  const bottom = extrudeShapes([disk(flangeRadius)], flangeT, HINGE_CURVE);
  const top = bottom.clone();
  bottom.translate(jointX, 0, 0);
  top.translate(jointX, 0, thickness - flangeT);
  return [shaft, bottom, top];
}

function knuckle(
  jointX: number,
  z: number,
  length: number,
  radius: number,
  holeRadius: number,
  plateEdge: number,
) {
  const barrel = extrudeShapes(
    [knuckleProfile(radius, holeRadius, Math.abs(plateEdge - jointX))],
    length,
    HINGE_CURVE,
  );
  if (plateEdge < jointX) barrel.rotateZ(Math.PI);
  barrel.translate(jointX, 0, z);
  return barrel;
}

// One outline: a circular bore, with the link tab meeting the outside of the barrel.
function knuckleProfile(radius: number, holeRadius: number, plateDistance: number) {
  const hy = radius * 0.58;
  const dx = Math.sqrt(Math.max(radius * radius - hy * hy, 0.01));
  const end = Math.max(plateDistance, dx + 0.45);
  const alpha = Math.atan2(hy, dx);
  const shape = new THREE.Shape();
  shape.moveTo(dx, hy);
  shape.absarc(0, 0, radius, alpha, Math.PI * 2 - alpha, false);
  shape.lineTo(end, -hy);
  shape.lineTo(end, hy);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

export function assertArticulatedHingeRound() {
  const radius = 2.16;
  const thickness = 5;
  const layout = hingeLayout(thickness, radius);
  const parts = linkJoint(0, -(radius + 0.35), radius + 0.35, thickness, radius);
  const knuckles = parts.slice(0, 3);
  const [shaft, bottomFlange, topFlange] = parts.slice(3);
  const samples = [
    layout.z0 + layout.femaleLength / 2,
    layout.maleStart + layout.maleLength + SIDE_CLEAR + layout.femaleLength / 2,
    layout.maleStart + layout.maleLength / 2,
  ];
  knuckles.forEach((knuckleGeometry, index) => {
    assertOpenCircle(knuckleGeometry, layout.holeRadius, "Hinge bore");
    const hits = boreHits(knuckleGeometry, samples[index]);
    const minHit = Math.min(...hits);
    const maxHit = Math.max(...hits);
    if (maxHit - minHit > 0.04 || Math.abs((minHit + maxHit) / 2 - layout.holeRadius) > 0.04) {
      throw new Error(
        `Hinge bore is not round (${minHit.toFixed(3)}–${maxHit.toFixed(3)} mm, expected ${layout.holeRadius.toFixed(3)})`,
      );
    }
  });
  assertDisk(shaft, layout.pinRadius, "Hinge pin");
  assertDisk(bottomFlange, layout.flangeRadius, "Hinge pin head");
  assertDisk(topFlange, layout.flangeRadius, "Hinge pin head");
  if (layout.holeRadius - layout.pinRadius < 0.3) {
    throw new Error("Hinge clearance is too tight to move after printing");
  }
  if (layout.flangeRadius <= layout.holeRadius) {
    throw new Error("Hinge pin head is not wider than the bore");
  }
  for (const part of parts) part.dispose();
}

export function assertBlockChain() {
  const chain = chainMetrics(6);
  const room = 7.6;
  const parts = chainLinks(room, chain);
  const [plate, bar, knuckle, keeper, axle] = parts;
  const holeX = -chain.shift;
  if (chain.holeR - chain.axleR < 0.3) throw new Error("Knuckle is too tight in the hole");
  if (chain.headR < chain.holeR + 0.3) throw new Error("Keeper can pull through the hole");

  const plateBox = geometryBounds(plate);
  const barBox = geometryBounds(bar);
  const knuckleBox = geometryBounds(knuckle);
  const keeperBox = geometryBounds(keeper);
  const plateZ = (plateBox.min.z + plateBox.max.z) / 2;
  if (plateBox.min.z < 0.2) throw new Error("Link plate sits below the bed");
  if (keeperBox.min.z < -0.01) throw new Error("Keeper sits below the bed");
  if (knuckleBox.min.z < plateBox.max.z + 0.25) throw new Error("Knuckle is touching the plate");
  if (barBox.min.z < plateBox.max.z + 0.25) throw new Error("Bar is touching the plate");
  if (keeperBox.max.z > plateBox.min.z - 0.25) throw new Error("Keeper is touching the plate");

  const hits = holeHits(plate, holeX, plateZ);
  const worst = Math.max(...hits.map((hit) => Math.abs(hit - chain.holeR)));
  if (worst > 0.08) throw new Error(`Link hole is not a circle (${worst.toFixed(3)} mm off)`);

  const position = plate.getAttribute("position");
  const angles: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const radius = Math.hypot(position.getX(index) - holeX, position.getY(index));
    if (Math.abs(radius - chain.holeR) < 0.06) {
      angles.push(Math.atan2(position.getY(index), position.getX(index) - holeX));
    }
  }
  if (widestAngleGap(angles) > Math.PI / 16) throw new Error("Link hole is not a full circle");

  const axlePosition = axle.getAttribute("position");
  for (let index = 0; index < axlePosition.count; index += 1) {
    const z = axlePosition.getZ(index);
    if (z < plateBox.min.z - 0.02 || z > plateBox.max.z + 0.02) continue;
    const radius = Math.hypot(axlePosition.getX(index) - holeX, axlePosition.getY(index));
    if (radius > chain.holeR - 0.25) throw new Error("Axle is rubbing the hole");
  }

  for (const part of parts) part.dispose();
}

function geometryBounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

function holeHits(geometry: THREE.BufferGeometry, holeX: number, zCenter: number) {
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const origin = new THREE.Vector3(holeX, 0, zCenter);
  const hits: number[] = [];
  for (let step = 0; step < 72; step += 1) {
    const angle = (step / 72) * Math.PI * 2;
    const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
    hits.push(raycaster.intersectObject(mesh)[0]?.distance ?? Infinity);
  }
  material.dispose();
  return hits;
}

function smoothGap(geometry: THREE.BufferGeometry, expected: number) {
  const position = geometry.getAttribute("position");
  const angles: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const pointRadius = Math.hypot(position.getX(index), position.getY(index));
    if (Math.abs(pointRadius - expected) < 0.08) {
      angles.push(Math.atan2(position.getY(index), position.getX(index)));
    }
  }
  if (angles.length < 40) return 360;
  const sorted = [...new Set(angles.map((angle) => Math.round(angle * 500) / 500))].sort((a, b) => a - b);
  const gaps: number[] = [sorted[0] + Math.PI * 2 - sorted[sorted.length - 1]];
  for (let index = 1; index < sorted.length; index += 1) gaps.push(sorted[index] - sorted[index - 1]);
  gaps.sort((a, b) => b - a);
  return ((gaps[1] ?? gaps[0]) * 180) / Math.PI;
}

function boreHits(geometry: THREE.BufferGeometry, z: number) {
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const origin = new THREE.Vector3(0, 0, z);
  const hits: number[] = [];
  for (let step = 0; step < 72; step += 1) {
    const angle = (step / 72) * Math.PI * 2;
    const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
    hits.push(raycaster.intersectObject(mesh)[0]?.distance ?? Infinity);
  }
  material.dispose();
  return hits;
}

function assertOpenCircle(geometry: THREE.BufferGeometry, expected: number, label: string) {
  const position = geometry.getAttribute("position");
  const angles: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const pointRadius = Math.hypot(position.getX(index), position.getY(index));
    if (pointRadius < expected - 0.02) {
      throw new Error(`${label} is blocked ${(expected - pointRadius).toFixed(3)} mm inside the circle`);
    }
    if (Math.abs(pointRadius - expected) < 0.05) angles.push(Math.atan2(position.getY(index), position.getX(index)));
  }
  if (widestAngleGap(angles) > Math.PI / 16) {
    throw new Error(`${label} is not a full circle`);
  }
}

function assertDisk(geometry: THREE.BufferGeometry, expected: number, label: string) {
  const position = geometry.getAttribute("position");
  const angles: number[] = [];
  let maxRadius = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const pointRadius = Math.hypot(x, y);
    maxRadius = Math.max(maxRadius, pointRadius);
    if (Math.abs(pointRadius - expected) < 0.05) angles.push(Math.atan2(y, x));
  }
  if (Math.abs(maxRadius - expected) > 0.04 || widestAngleGap(angles) > Math.PI / 16) {
    throw new Error(`${label} is not a circle (radius ${maxRadius.toFixed(3)} mm, expected ${expected.toFixed(3)})`);
  }
}

function widestAngleGap(angles: number[]) {
  if (!angles.length) return Math.PI * 2;
  const sorted = [...angles].sort((a, b) => a - b);
  let widest = sorted[0] + Math.PI * 2 - sorted[sorted.length - 1];
  for (let index = 1; index < sorted.length; index += 1) {
    widest = Math.max(widest, sorted[index] - sorted[index - 1]);
  }
  return widest;
}

function channel(length: number, innerRadius: number, wall: number, curve: number) {
  const outer = innerRadius + wall;
  const halfGap = 0.52;
  const center = Math.PI / 2;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, center + halfGap, center - halfGap + Math.PI * 2, false);
  shape.absarc(0, 0, innerRadius, center - halfGap + Math.PI * 2, center + halfGap, true);
  const geometry = extrudeShapes([shape], Math.max(length, 4), curve);
  geometry.translate(0, 0, -Math.max(length, 4) / 2);
  geometry.rotateY(Math.PI / 2);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function arcBand(radius: number, width: number, angle: number) {
  const shape = new THREE.Shape();
  const start = Math.PI / 2 - angle / 2;
  const end = Math.PI / 2 + angle / 2;
  shape.absarc(0, 0, radius + width / 2, start, end, false);
  shape.absarc(0, 0, Math.max(8, radius - width / 2), end, start, true);
  return shape;
}

function frameShape(outerW: number, outerH: number, innerW: number, innerH: number) {
  const shape = roundedRect(outerW, outerH, 4);
  const hole = new THREE.Path();
  const x = -innerW / 2;
  const y = -innerH / 2;
  hole.moveTo(x, y);
  hole.lineTo(x, y + innerH);
  hole.lineTo(x + innerW, y + innerH);
  hole.lineTo(x + innerW, y);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

function plateWithHoles(
  width: number,
  height: number,
  radius: number,
  holeRadius: number,
  holeX: number,
  holeY: number,
) {
  const shape = roundedRect(width, height, radius);
  for (const x of [-holeX, holeX]) {
    const hole = new THREE.Path();
    hole.absarc(x, holeY, holeRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return shape;
}

function roundedRect(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.absarc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + width, y + height - r);
  shape.absarc(x + width - r, y + height - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + height);
  shape.absarc(x + r, y + height - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function ring(outer: number, inner: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function disk(radius: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

function tube(outer: number, inner: number, length: number, curve: number) {
  return extrudeShapes([ring(outer, inner)], length, curve);
}

function boundsOf(glyphs: GlyphLayout[]) {
  return glyphs.reduce(
    (bounds, glyph) => ({
      minX: Math.min(bounds.minX, glyph.minX),
      minY: Math.min(bounds.minY, glyph.minY),
      maxX: Math.max(bounds.maxX, glyph.maxX),
      maxY: Math.max(bounds.maxY, glyph.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function turnUpright(geometry: THREE.BufferGeometry) {
  geometry.rotateX(Math.PI / 2);
}

function fuse(parts: THREE.BufferGeometry[]) {
  const list = parts
    .filter((part) => (part.getAttribute("position")?.count ?? 0) > 0)
    .map((part) => {
      if (!part.index) return part;
      const flat = part.toNonIndexed();
      part.dispose();
      return flat;
    });
  if (!list.length) throw new Error("That model has no printable shape.");
  if (list.length === 1) return list[0];
  const merged = mergeGeometries(list, false);
  if (!merged) throw new Error("Could not combine the model parts.");
  for (const part of list) part.dispose();
  if (!merged.getAttribute("normal")) merged.computeVertexNormals();
  return merged;
}

function pack(
  text: THREE.BufferGeometry,
  base: THREE.BufferGeometry,
  warnings: string[],
  anchor?: { anchorX: number; anchorY: number; charmBounds: KeychainModel["charmBounds"] },
): KeychainModel {
  text.computeBoundingBox();
  base.computeBoundingBox();
  const box = new THREE.Box3();
  if (text.boundingBox) box.union(text.boundingBox);
  if (base.boundingBox) box.union(base.boundingBox);
  if (box.isEmpty() || !Number.isFinite(box.min.x)) throw new Error("That model has no printable shape.");
  const centerX = anchor?.anchorX ?? (box.min.x + box.max.x) / 2;
  const centerY = anchor?.anchorY ?? (box.min.y + box.max.y) / 2;
  text.translate(-centerX, -centerY, -box.min.z);
  base.translate(-centerX, -centerY, -box.min.z);
  const size = box.getSize(new THREE.Vector3());
  const charmBounds = (anchor?.charmBounds ?? []).map((box) => ({
    minX: box.minX - centerX,
    minY: box.minY - centerY,
    maxX: box.maxX - centerX,
    maxY: box.maxY - centerY,
  }));
  return {
    text,
    base,
    width: size.x,
    height: size.y,
    depth: size.z,
    warnings,
    charmBounds,
    hole: null,
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
