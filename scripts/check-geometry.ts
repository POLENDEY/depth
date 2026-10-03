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
import { buildKeychain } from "../lib/geometry";
import { exportKeychain } from "../lib/export";

const defaults = {
  text: "PAUL",
  letterHeight: 18,
  outline: 2.4,
  holeEnabled: true,
  holeDiameter: 5,
  holeSide: "left" as const,
  baseThickness: 2.4,
  textThickness: 1.6,
  charm: false,
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

  model.text.dispose();
  model.base.dispose();
  second.text.dispose();
  second.base.dispose();
  holeless.text.dispose();
  holeless.base.dispose();
  console.log("geometry ok");
}

void main();
