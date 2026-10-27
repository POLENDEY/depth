import { readFileSync } from "node:fs";

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: null | (() => void) = null;
  onerror: null | (() => void) = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}

globalThis.FileReader = NodeFileReader as unknown as typeof FileReader;
import opentype from "opentype.js";
import { unzipSync } from "fflate";
import type * as THREE from "three";
import { LOOP_STYLES, PRODUCTS, SURFACE_PATTERNS } from "../lib/catalog";
import { registerLogo } from "../lib/charms";
import { bounds, clickerLayout, clickerLayoutInput, HOUSING_SHAPES, partsLayout } from "../lib/clicker-layout";
import { registerImageParts } from "../lib/image-parts";
import { buildKeychain } from "../lib/geometry";
import { exportKeychain } from "../lib/export";
import {
  assertArticulatedHingeRound,
  assertBlockChain,
  buildProduct,
  CLICKER,
  clickerLength,
  flexiMetrics,
} from "../lib/models";

const defaults = {
  text: "PAUL",
  letterHeight: 18,
  lineSpacing: 4,
  outline: 2.4,
  holeEnabled: true,
  holeDiameter: 5,
  holeSide: "left" as const,
  baseThickness: 2.4,
  textThickness: 1.6,
  charms: [] as { id: string; x: number; y: number; size: number }[],
  charmBase: 1.2,
  holeOffsetX: 0,
  holeOffsetY: 0,
};

function parseFont(file: string) {
  const buffer = readFileSync(file);
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return opentype.parse(copy);
}

const font = parseFont("public/fonts/luckiest-guy.woff");
const started = performance.now();
const model = buildKeychain(font, defaults, "preview");
const elapsed = performance.now() - started;
const again = performance.now();
const second = buildKeychain(font, defaults, "preview");
const cached = performance.now() - again;

console.log(
  JSON.stringify(
    {
      elapsed: Math.round(elapsed),
      cached: Math.round(cached),
      width: model.width.toFixed(2),
      height: model.height.toFixed(2),
      depth: model.depth.toFixed(2),
      textVerts: model.text.getAttribute("position").count,
      baseVerts: model.base.getAttribute("position").count,
      warnings: model.warnings,
    },
    null,
    2,
  ),
);

if (model.width < 40 || model.width > 130) throw new Error(`Unexpected width ${model.width}`);
if (model.height < 15 || model.height > 50) throw new Error(`Unexpected height ${model.height}`);
if (Math.abs(model.depth - 4) > 0.05) throw new Error(`Unexpected depth ${model.depth}`);
if (elapsed > 250) throw new Error(`Preview build too slow: ${elapsed}ms`);

const holeless = buildKeychain(font, { ...defaults, holeEnabled: false }, "preview");
if (holeless.width >= model.width - 1) {
  throw new Error("Keyring tab did not extend the keychain");
}

async function main() {
  const exported = await exportKeychain(model, "3mf", "#f4f4f5", "#8d79f6", "paul");
  const bytes = new Uint8Array(await exported.blob.arrayBuffer());
  const unzipped = unzipSync(bytes);
  if (!unzipped["3D/3dmodel.model"]) throw new Error("3MF is missing the model part");
  const xml = new TextDecoder().decode(unzipped["3D/3dmodel.model"]);
  if (!xml.includes('unit="millimeter"')) throw new Error("3MF is not in millimeters");
  if (!xml.includes("#f4f4f5") || !xml.includes("#8d79f6")) throw new Error("3MF is missing colors");

  const stl = await exportKeychain(model, "stl", "#f4f4f5", "#8d79f6", "paul");
  if (stl.blob.size < 1000) throw new Error("STL is too small");
  const obj = await exportKeychain(model, "obj", "#f4f4f5", "#8d79f6", "paul");
  const objText = await obj.blob.text();
  if (!objText.includes("o Base") || !objText.includes("o Text")) throw new Error("OBJ is missing parts");
  const glb = await exportKeychain(second, "glb", "#ffffff", "#8d79f6", "paul");
  if (glb.blob.size < 500) throw new Error("GLB is too small");

  for (const file of [
    "public/fonts/lilita-one.ttf",
    "public/fonts/bangers.ttf",
    "public/fonts/fredoka-bold.woff",
    "public/fonts/pacifico.ttf",
    "public/fonts/nunito-extrabold.woff",
  ]) {
    const other = parseFont(file);
    const built = buildKeychain(other, { ...defaults, text: "PAUL" }, "preview");
    if (built.width < 10) throw new Error(`${file} produced a tiny mesh`);
    built.text.dispose();
    built.base.dispose();
  }

  for (const product of PRODUCTS) {
    if (product.slug === "name-keychain") continue;
    const built = buildProduct(product.slug, font, product.settings, "preview");
    if (!Number.isFinite(built.width) || built.width < 5 || built.depth < 0.5) {
      throw new Error(`${product.slug} has a bad size ${built.width} x ${built.height} x ${built.depth}`);
    }
    if (built.text.getAttribute("position").count < 12 || built.base.getAttribute("position").count < 12) {
      throw new Error(`${product.slug} mesh is empty`);
    }
    console.log(
      product.slug,
      built.width.toFixed(1),
      "x",
      built.height.toFixed(1),
      "x",
      built.depth.toFixed(1),
    );
    built.text.dispose();
    built.base.dispose();
  }

  assertArticulatedHingeRound();
  assertBlockChain();
  assertFlexi();
  assertClicker();

  model.text.dispose();
  model.base.dispose();
  second.text.dispose();
  second.base.dispose();
  holeless.text.dispose();
  holeless.base.dispose();
  console.log("geometry ok");
}

function assertFlexi() {
  for (const size of [14, 18, 26]) {
    for (const thickness of [5, 6, 8]) {
      const joint = flexiMetrics(size, thickness);
      if (joint.bore - joint.pin < 0.3) throw new Error("Flexi pin is too tight to turn after printing");
      if (joint.nose - joint.bore < 0.9) throw new Error("Flexi tongue wall around the pin is too thin");
      if (joint.tongueTop - joint.tongueBottom < 1.4) throw new Error("Flexi tongue is too thin");
      if (joint.gap / 2 - joint.nose < 0.3) throw new Error("Flexi joint nose touches the next bead");
    }
  }
  const product = PRODUCTS.find((entry) => entry.slug === "flexi-keychain");
  if (!product) throw new Error("Flexi keychain is missing from the catalog");
  const lilita = parseFont("public/fonts/lilita-one.ttf");
  const one = buildProduct("flexi-keychain", lilita, { ...product.settings, text: "A" }, "preview");
  const four = buildProduct("flexi-keychain", lilita, { ...product.settings, text: "L O V E" }, "preview");
  const joint = flexiMetrics(product.settings.linkSize, product.settings.baseThickness);
  const gain = four.width - one.width;
  const pitch = product.settings.linkSize + joint.gap;
  if (Math.abs(gain - pitch * 3) > 0.05) throw new Error(`Flexi beads are not evenly spaced (${gain.toFixed(2)} mm)`);
  if (Math.abs(four.height - product.settings.linkSize) > 0.05) throw new Error("Flexi beads are not square");
  four.base.computeBoundingBox();
  four.text.computeBoundingBox();
  const body = four.base.boundingBox!;
  const letters = four.text.boundingBox!;
  if (letters.min.z < body.max.z - 0.3 || letters.max.z < body.max.z + 0.6) {
    throw new Error("Flexi letters are not raised on the beads");
  }
  for (const built of [one, four]) {
    built.text.dispose();
    built.base.dispose();
  }
}

// MX switch: 14 mm cutout, 15.6 mm top housing at the plate, 8.3 mm of body and pins below
// the plate top, 6.6 mm of housing above it, 4 mm of travel.
// Directed edges without a matching reverse edge: zero for a closed, consistently wound mesh.
function openEdges(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const key = (index: number) =>
    [position.getX(index), position.getY(index), position.getZ(index)].map((value) => Math.round(value * 1e4)).join(",");
  const edges = new Map<string, number>();
  for (let index = 0; index < position.count; index += 3) {
    const corners = [key(index), key(index + 1), key(index + 2)];
    for (let side = 0; side < 3; side += 1) {
      const edge = `${corners[side]}>${corners[(side + 1) % 3]}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [edge, count] of edges) {
    const [a, b] = edge.split(">");
    if ((edges.get(`${b}>${a}`) ?? 0) !== count) open += 1;
  }
  return open;
}

function assertClicker() {
  const k = CLICKER;
  if (k.cutout < 14 || k.cutout > 14.3) throw new Error("Clicker switch cutout is not 14 mm");
  if (k.pocket - k.cap < 0.6) throw new Error("Clicker keycap rubs the pocket wall");
  if (k.cap - k.skirtWall * 2 < 15.6 + 0.6) throw new Error("Clicker keycap skirt hits the switch housing");
  if (k.below + k.plate < 8.3 + 0.8) throw new Error("Clicker cavity is too shallow for the switch pins");
  if (k.cavity - k.cutout < 0.8) throw new Error("Clicker cavity leaves no room for the switch clips");
  if ((k.unit - k.pocket) / 2 < 1.6) throw new Error("Clicker housing walls are too thin");
  if (6.6 + k.capHeight - k.wall < 4 + 1) throw new Error("Clicker keycap sinks below the wall when pressed");
  if (k.crossLength < 4.05 || k.crossWidth < 1.2) throw new Error("Clicker cross socket is too tight");

  const product = PRODUCTS.find((entry) => entry.slug === "clicker-keychain");
  if (!product) throw new Error("Clicker is missing from the catalog");
  const lilita = parseFont("public/fonts/lilita-one.ttf");
  const one = buildProduct("clicker-keychain", lilita, { ...product.settings, text: "A" }, "preview");
  const three = buildProduct("clicker-keychain", lilita, { ...product.settings, text: "ABC" }, "preview");
  if (Math.abs(three.width - one.width - k.pitch * 2) > 0.05) throw new Error("Clicker does not add one socket per letter");
  if (Math.abs(k.pitch - k.pocket - (k.unit - k.pocket) / 2) > 0.001) throw new Error("Clicker walls between keys differ from the outer walls");
  const height = k.floor + k.below + k.plate + k.wall;
  if (Math.abs(three.depth - height) > 0.05) throw new Error(`Clicker housing is ${three.depth.toFixed(2)} mm tall`);
  three.text.computeBoundingBox();
  const letters = three.text.boundingBox!;
  if (letters.min.z < k.capHeight - 0.3 || letters.max.z < k.capHeight + 0.5) {
    throw new Error("Clicker letters are not on the keycap tops");
  }
  for (const built of [one, three]) {
    built.text.dispose();
    built.base.dispose();
  }
  for (const surface of SURFACE_PATTERNS.map((pattern) => pattern.value)) {
    const started = performance.now();
    const built = buildProduct("clicker-keychain", lilita, { ...product.settings, text: "ABC", surface, loopStyle: "none" }, "print");
    const took = performance.now() - started;
    if (took > 4000) throw new Error(`Clicker ${surface} pattern took ${took.toFixed(0)} ms to build`);
    const open = openEdges(built.base);
    if (open) throw new Error(`Clicker ${surface} pattern leaves ${open} open edges`);
    const extra = built.width - clickerLength(3);
    if (surface !== "plain" && (extra < 0.6 || extra > 1.25)) throw new Error(`Clicker ${surface} pattern stands ${(extra / 2).toFixed(2)} mm off the housing`);
    built.text.dispose();
    built.base.dispose();
  }
  if (k.pocket - k.cap < 0.6) throw new Error("Clicker keycap pattern would rub the pocket");
  for (const loopStyle of LOOP_STYLES.map((style) => style.value)) {
    for (const loopSide of ["left", "right"] as const) {
      const built = buildProduct("clicker-keychain", lilita, { ...product.settings, text: "A", loopStyle, loopSide }, "preview");
      const extra = built.width - k.unit;
      if (loopStyle === "none" ? Math.abs(extra) > 0.05 : extra < 6 || extra > 25) {
        throw new Error(`Clicker ${loopStyle} loop on the ${loopSide} sticks out ${extra.toFixed(1)} mm`);
      }
      built.text.dispose();
      built.base.dispose();
    }
  }

  const blob = Array.from({ length: 40 }, (_, index): [number, number] => {
    const angle = (index / 40) * Math.PI * 2;
    const radius = 0.4 + 0.08 * Math.cos(angle * 5);
    return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7];
  });
  const housingLogo = registerLogo([blob], "");
  for (const housingShape of HOUSING_SHAPES.map((shape) => shape.value)) {
    for (const capShape of ["match", "square"] as const) {
      const settings = { ...product.settings, text: "ABC", housingShape, capShape, housingLogo, surface: "ribs" as const };
      const started = performance.now();
      const built = buildProduct("clicker-keychain", lilita, settings, "print");
      const took = performance.now() - started;
      if (took > 6000) throw new Error(`Clicker ${housingShape} housing took ${took.toFixed(0)} ms to build`);
      const open = openEdges(built.base);
      if (open) throw new Error(`Clicker ${housingShape} housing with ${capShape} caps leaves ${open} open edges`);
      const layout = clickerLayout(clickerLayoutInput(settings, 3));
      const cap = bounds(layout.cap);
      if (cap.maxX - cap.minX < k.cap - 0.01 || cap.maxY - cap.minY < k.cap - 0.01) {
        throw new Error(`Clicker ${housingShape} keycap does not cover its switch`);
      }
      console.log(`  clicker ${housingShape}/${capShape}: ${built.width.toFixed(1)} x ${built.height.toFixed(1)} mm, ${took.toFixed(0)} ms`);
      built.text.dispose();
      built.base.dispose();
    }
  }
  const stacked = { ...product.settings, text: "AB", keyLayout: [{ x: 0, y: 0 }, { x: 0, y: k.pitch }] };
  const tall = buildProduct("clicker-keychain", lilita, stacked, "preview");
  if (openEdges(tall.base)) throw new Error("Clicker with stacked keys leaves open edges");
  tall.text.dispose();
  tall.base.dispose();
  const crowded = { ...product.settings, text: "AB", keyLayout: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  if (!clickerLayout(clickerLayoutInput(crowded)).error) throw new Error("Clicker allows overlapping keys");

  const circle = (cx: number, cy: number, rx: number, ry = rx) =>
    Array.from({ length: 64 }, (_, index) => {
      const angle = (index / 64) * Math.PI * 2;
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
  const rocket = registerImageParts([
    { color: "#dfe6ec", rings: [circle(0, 0.02, 0.17, 0.42), circle(0, 0.12, 0.1).reverse()], area: 0.2 },
    { color: "#4a90d9", rings: [circle(0, 0.12, 0.1)], area: 0.03 },
    { color: "#d92b3a", rings: [[{ x: -0.15, y: -0.1 }, { x: -0.36, y: -0.47 }, { x: -0.1, y: -0.33 }]], area: 0.03 },
    { color: "#d92b3a", rings: [[{ x: 0.15, y: -0.1 }, { x: 0.1, y: -0.33 }, { x: 0.36, y: -0.47 }]], area: 0.03 },
  ]);
  const picked = {
    ...product.settings,
    housingShape: "custom" as const,
    housingLogo: rocket,
    housingParts: [[1], [2]],
    partCaps: "parts" as const,
  };
  const started = performance.now();
  const parts = buildProduct("clicker-keychain", lilita, picked, "print");
  const took = performance.now() - started;
  const partsLayoutResult = partsLayout(rocket, picked.housingParts, 0, "parts")!;
  if (partsLayoutResult.keys.length !== 2) throw new Error("Image clicker does not make one key per picked part");
  if (openEdges(parts.base) || openEdges(parts.text)) throw new Error("Image clicker leaves open edges");
  const colors = parts.text.userData.slotColors as string[];
  if (!colors.includes("#d92b3a") || !colors.includes("#4a90d9")) throw new Error("Image clicker drops the picture colors");
  console.log(`  clicker from image parts: ${parts.width.toFixed(1)} x ${parts.height.toFixed(1)} mm, ${colors.length} colors, ${took.toFixed(0)} ms`);
  const whole = partsLayout(rocket, [[0]], 0, "whole")!;
  const exact = partsLayout(rocket, [[0]], 0, "parts")!;
  const capColors = (layout: typeof whole) => layout.keys[0].inlays.map((inlay) => inlay.color);
  if (whole.error || whole.keys.length !== 1 || whole.lid.length) throw new Error("Whole cap is not one cap covering the picture");
  if (!["#4a90d9", "#d92b3a", "#dfe6ec"].every((color) => capColors(whole).includes(color))) {
    throw new Error("Whole cap leaves out picture colors");
  }
  if (exact.error || capColors(exact).includes("#4a90d9")) throw new Error("By-parts cap takes in the details inside its part");
  if (!whole.keys[0].border.length || !exact.keys[0].border.length) throw new Error("Image clicker caps have no border");
  const sized = partsLayout(rocket, [[0]], 300, "whole")!;
  const sizedBox = bounds(sized.outline);
  if (Math.abs(Math.max(sizedBox.maxX - sizedBox.minX, sizedBox.maxY - sizedBox.minY) - 300) > 6) {
    throw new Error("Image clicker ignores the chosen size");
  }
  const wholeBuilt = buildProduct("clicker-keychain", lilita, { ...picked, housingParts: [[0]], partCaps: "whole" as const }, "preview");
  if (openEdges(wholeBuilt.base)) throw new Error(`Whole-cap image clicker base leaves ${openEdges(wholeBuilt.base)} open edges`);
  if (openEdges(wholeBuilt.text)) throw new Error(`Whole-cap image clicker cap leaves ${openEdges(wholeBuilt.text)} open edges`);
  const groupBox = (group: { start: number; count: number }) => {
    const position = wholeBuilt.text.getAttribute("position");
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let index = group.start; index < group.start + group.count; index += 1) {
      box.minX = Math.min(box.minX, position.getX(index));
      box.minY = Math.min(box.minY, position.getY(index));
      box.maxX = Math.max(box.maxX, position.getX(index));
      box.maxY = Math.max(box.maxY, position.getY(index));
    }
    return box;
  };
  const [capGroup, ...inlayGroups] = wholeBuilt.text.groups.map(groupBox);
  const onCap = (inlay: typeof capGroup) =>
    inlay.minX >= capGroup.minX - 0.01 && inlay.maxX <= capGroup.maxX + 0.01 && inlay.minY >= capGroup.minY - 0.01 && inlay.maxY <= capGroup.maxY + 0.01;
  if (!inlayGroups.every(onCap)) throw new Error("Cap colors are not placed on the cap");
  wholeBuilt.text.dispose();
  wholeBuilt.base.dispose();
  parts.text.dispose();
  parts.base.dispose();
}

void main();
