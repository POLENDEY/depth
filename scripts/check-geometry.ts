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
import { LOOP_STYLES, PRODUCTS } from "../lib/catalog";
import { buildKeychain } from "../lib/geometry";
import { exportKeychain } from "../lib/export";
import { assertArticulatedHingeRound, assertBlockChain, buildProduct, CLICKER, flexiMetrics } from "../lib/models";

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
  if (Math.abs(three.width - one.width - k.unit * 2) > 0.05) throw new Error("Clicker does not add one socket per letter");
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
}

void main();
