import type { Font } from "opentype.js";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TAG_GROUPS, type ProductSettings, type TagShape } from "./catalog";
import { decodeSpotifyBars, spotifyLogoLoops, type SpotifyPoint } from "./spotify-code";
import { familiarParts, type TagPoint } from "./tag-shapes";
import {
  cutShapes,
  extrudeShapes,
  layoutText,
  outlinedMagnet,
  type GlyphLayout,
  type KeychainModel,
  type MeshQuality,
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
