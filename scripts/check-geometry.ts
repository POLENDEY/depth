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
import * as THREE from "three";
import { LOOP_STYLES, PRODUCTS, SURFACE_PATTERNS } from "../lib/catalog";
import { registerLogo } from "../lib/charms";
import { bounds, clickerLayout, clickerLayoutInput, HOUSING_SHAPES, partsLayout } from "../lib/clicker-layout";
import { registerImageParts } from "../lib/image-parts";
import { buildKeychain, disposeModel } from "../lib/geometry";
import { exportKeychain } from "../lib/export";
import { drilled as drilledSolid, ensureManifold, manifoldKernel, solidPositions } from "../lib/manifold";
import { repairMesh, type MeshRepair } from "../lib/mesh-repair";
import { SurfaceMap } from "../lib/smart-fill";
import {
  clickerPlan,
  CUT,
  cutFrameModel,
  ensureSampleModel,
  importedModel,
  registerModel,
  SAMPLE_MODEL,
  smallestSize,
  switchArea,
  tunnelPoint,
} from "../lib/model-import";
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

// Smart fill splits at sharp edges and suggests a cut that takes the clicked region off.
function assertSmartFill() {
  const box = (w: number, d: number, h: number, x: number, y: number, z: number) =>
    new THREE.BoxGeometry(w, d, h).toNonIndexed().translate(x, y, z).getAttribute("position").array as Float32Array;
  const tall = box(20, 20, 40, 0, 0, 20);
  const cube = new SurfaceMap(tall);
  const count = (labels: Int32Array) => new Set(labels).size;
  if (count(cube.labels(30)) !== 6) throw new Error(`a box should be 6 smart-fill regions, got ${count(cube.labels(30))}`);
  if (count(cube.labels(90)) !== 1) throw new Error("a box at 90° should be one region");
  const labels = cube.labels(30);
  const topFace = labels.findIndex((_, face) => cube.normals[face * 3 + 2] > 0.99);
  const top = cube.suggestCut(labels, labels[topFace]);
  if (!top || top.tilt !== 0 || Math.abs(top.offset - 39.6) > 1e-3) throw new Error(`top face cut is off: ${JSON.stringify(top)}`);
  if (cube.outline(labels, labels[topFace]).length !== 4 * 6) throw new Error("the top face's outline should be its 4 edges");
  if (cube.suggestCut(cube.labels(90), cube.labels(90)[0])) throw new Error("a region that is the whole model can't be cut off");

  // A handle sticking out to +x comes off with a cut facing about +x.
  const handle = box(10, 6, 6, 15, 0, 20);
  const both = new Float32Array(tall.length + handle.length);
  both.set(tall);
  both.set(handle, tall.length);
  const cup = new SurfaceMap(both);
  const merged = cup.labels(90);
  const side = cup.suggestCut(merged, merged[tall.length / 9]);
  if (!side || side.normal[0] < 0.7 || side.at[0] < 19.9) {
    throw new Error(`handle cut is off: ${JSON.stringify(side)}`);
  }
}

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
  await ensureManifold();
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
  await assertModelClicker();

  model.text.dispose();
  model.base.dispose();
  second.text.dispose();
  second.base.dispose();
  holeless.text.dispose();
  holeless.base.dispose();
  assertSmartFill();
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

async function assertModelClicker() {
  const product = PRODUCTS.find((entry) => entry.slug === "model-clicker");
  if (!product) throw new Error("3D clicker is missing from the catalog");
  const k = CLICKER;
  // The switch holds the cap up by the travel gap, with its stem top (11.6 mm over the plate,
  // as in the other clickers) at the socket's ceiling. Pressed 4 mm, the cap stops short of
  // the housing and the pocket floor, its hollow clears the switch top, and the plug stays in.
  if (CUT.travel < 4.2) throw new Error("3D clicker cap hits the housing before the switch bottoms out");
  const stemTop = 11.6;
  if (Math.abs(CUT.plug + CUT.travel + CUT.ceiling - 0.3 - stemTop) > 0.05) {
    throw new Error("3D clicker socket doesn't meet the stem with the cap up");
  }
  if (CUT.travel + CUT.plug + CUT.ceiling - 4 < 6.6 + 0.4) throw new Error("3D clicker cap hollow hits the switch top when pressed");
  if (CUT.plug - CUT.travel < 2) throw new Error("3D clicker plug slips out of the pocket with the cap up");
  if (CUT.hollow < 15.6 + 0.6) throw new Error("3D clicker cap hollow rubs the switch housing");
  if (CUT.base < k.floor + k.below + k.plate) throw new Error("3D clicker housing is too shallow for the switch pins");

  ensureSampleModel();
  const least = smallestSize(SAMPLE_MODEL);
  if (!least || least < 20 || least > 120) throw new Error(`3D clicker sample's smallest size is ${least} mm`);
  const tooSmall = clickerPlan(SAMPLE_MODEL, least / 2, 0, null);
  if (tooSmall.size !== least) throw new Error("3D clicker object shrank below the switch");
  const plan = clickerPlan(SAMPLE_MODEL, product.settings.housingSize, 0, null);
  if (!plan.cuts.includes(plan.cut)) throw new Error("3D clicker picked a cut the switch doesn't fit");
  const far = clickerPlan(SAMPLE_MODEL, product.settings.housingSize, 0, { x: 400, y: 400 });
  const farCell = Math.hypot(far.at.x - 400 * far.scale, far.at.y - 400 * far.scale);
  if (farCell < 1 || !switchArea(far).length) throw new Error("3D clicker switch was not pulled back inside");

  const cube = new THREE.BoxGeometry(40, 40, 40).toNonIndexed();
  cube.translate(0, 0, 20);
  const cubeId = registerModel("Cube", Float32Array.from(cube.getAttribute("position").array));
  const cubePlan = clickerPlan(cubeId, 40, 0.6, null);
  if (Math.abs(cubePlan.cut - 24) > 1 || Math.abs(cubePlan.at.x) > 1 || Math.abs(cubePlan.at.y) > 1) {
    throw new Error(`3D clicker cube cut ${cubePlan.cut.toFixed(1)} mm with the switch at ${cubePlan.at.x.toFixed(1)}, ${cubePlan.at.y.toFixed(1)}`);
  }

  await ensureManifold();
  const settings = { ...product.settings, modelId: cubeId, housingSize: 40, modelCut: 0.6 };
  const print = buildProduct("model-clicker", null, settings, "print");
  for (const [name, geometry] of [["object", print.text], ["borders", print.base]] as const) {
    if (openEdges(geometry)) throw new Error(`3D clicker ${name} is not watertight`);
  }
  print.base.computeBoundingBox();
  const bands = print.base.boundingBox!;
  if (bands.min.z > 0.01) throw new Error("3D clicker cap border doesn't sit on the bed");
  if (Math.abs(print.depth - Math.max(cubePlan.cut, 40 - cubePlan.cut + CUT.plug)) > 0.3) {
    throw new Error(`3D clicker print layout is ${print.depth.toFixed(1)} mm tall`);
  }
  const preview = buildProduct("model-clicker", null, settings, "preview");
  if (!preview.cut || Math.abs(preview.cut.mm - cubePlan.cut) > 0.01) throw new Error("3D clicker preview lost its cut");
  if (Math.abs(preview.depth - print.depth) > 0.3) throw new Error("3D clicker preview isn't laid out on the bed like the print");
  const fit = preview.assembly;
  if (!fit) throw new Error("3D clicker preview has no parts to animate");
  const housingBox = new THREE.Box3().setFromBufferAttribute(fit.housing.text.getAttribute("position") as THREE.BufferAttribute);
  const capBox = new THREE.Box3().setFromBufferAttribute(fit.cap.text.getAttribute("position") as THREE.BufferAttribute);
  const capBorderBox = new THREE.Box3().setFromBufferAttribute(fit.cap.base.getAttribute("position") as THREE.BufferAttribute);
  if (capBorderBox.min.z > 0.01 || housingBox.min.z > 0.01) throw new Error("3D clicker parts aren't both on the bed");
  if (capBox.min.x < housingBox.max.x) throw new Error("3D clicker cap overlaps the housing on the bed");
  const seated = capBorderBox.min.z + fit.offset.z;
  if (Math.abs(seated - (cubePlan.cut - CUT.plug + CUT.travel)) > 0.01) throw new Error(`3D clicker cap rests at ${seated.toFixed(2)} mm`);
  const housingTop = new THREE.Box3().setFromBufferAttribute(fit.housing.base.getAttribute("position") as THREE.BufferAttribute).max.z;
  const capFace = capBorderBox.min.z + CUT.plug + fit.offset.z - fit.press;
  if (capFace - housingTop < 0.2) throw new Error("3D clicker cap hits the housing before the switch bottoms out");
  const rimBox = new THREE.Box3().setFromBufferAttribute(fit.housing.base.getAttribute("position") as THREE.BufferAttribute);
  const capCenter = (capBorderBox.min.x + capBorderBox.max.x) / 2 + fit.offset.x;
  if (Math.abs(capCenter - (rimBox.min.x + rimBox.max.x) / 2) > 0.5) throw new Error("3D clicker cap doesn't land over the housing");
  const lower = buildProduct("model-clicker", null, { ...settings, modelCut: 0.48 }, "preview");
  if (!lower.cut || lower.cut.mm >= preview.cut.mm - 2) throw new Error("3D clicker cut didn't move");

  const holeSettings = { ...settings, housingSize: 70, loopStyle: "object" as const };
  const holePlan = clickerPlan(cubeId, 70, 0.6, null);
  const straight = buildProduct("model-clicker", null, { ...holeSettings, modelHoleShape: "straight" }, "print");
  const drilled = buildProduct("model-clicker", null, holeSettings, "print");
  for (const built of [straight, drilled]) {
    if (!built.hole?.axis) throw new Error("3D clicker did not drill the object");
    if (openEdges(built.text) || openEdges(built.base)) throw new Error("Drilled 3D clicker is not watertight");
    if (built.warnings.some((warning) => warning.includes("buried") || warning.includes("runs into"))) {
      throw new Error(`3D clicker hole misplaced: ${built.warnings[0]}`);
    }
  }
  const hole = drilled.hole!;
  if (hole.radius <= straight.hole!.radius || drilled.text.getAttribute("position").count === straight.text.getAttribute("position").count) {
    throw new Error("3D clicker curved hole is the same as the straight one");
  }
  const onCap = hole.v! * hole.unit! + hole.radius - holeSettings.holeDiameter > holePlan.cut;
  if (onCap !== drilled.warnings.some((warning) => warning.includes("glue"))) throw new Error("3D clicker glue note doesn't match the hole");
  const moved = buildProduct(
    "model-clicker",
    null,
    { ...holeSettings, modelHole: { x: hole.u! + 5, y: hole.v! - 2 } },
    "print",
  );
  if (!moved.hole || Math.abs(moved.hole.z! - (hole.z! - 2 * hole.unit!)) > 0.01) {
    throw new Error("Dragged 3D clicker hole did not move");
  }
  // Tipped and turned tunnels: the solid's hole runs where the warnings think it does.
  const { Manifold } = manifoldKernel();
  const block = Manifold.cube([200, 200, 200], true);
  for (const axis of ["x", "y"] as const) {
    for (const [tilt, turn] of [[0, 0], [90, 0], [45, 120], [150, 300]]) {
      const tunnel = { axis, u: 7, v: -5, depth: 9, ring: 20, tilt, turn };
      const bored = drilledSolid(`check:${axis}`, block, { ...tunnel, radius: 2 }, 1000);
      for (let step = 0; step < 12; step += 1) {
        const [x, y, z] = tunnelPoint(tunnel, (step / 12) * Math.PI * 2);
        const probe = Manifold.cube([0.5, 0.5, 0.5], true).translate(x, y, z);
        const left = bored.intersect(probe);
        const solid = left.volume();
        left.delete();
        probe.delete();
        if (solid > 0.01) throw new Error(`3D clicker ${axis} tunnel tilted ${tilt}° turned ${turn}° isn't where its math says`);
      }
    }
  }
  block.delete();
  const tipped = [
    { modelHoleTilt: 90, modelHoleTurn: 0 },
    { modelHoleTilt: 45, modelHoleTurn: 90 },
  ].map((direction) => buildProduct("model-clicker", null, { ...holeSettings, ...direction }, "print"));
  for (const built of tipped) {
    if (openEdges(built.text) || openEdges(built.base)) throw new Error("Tipped 3D clicker tunnel is not watertight");
    const misplaced = built.warnings.find((warning) => /buried|outside the object/.test(warning));
    if (misplaced) throw new Error(`Tipped 3D clicker tunnel: ${misplaced}`);
    if (!built.hole || Math.abs(built.hole.x - hole.x) + Math.abs(built.hole.y - hole.y) + Math.abs(built.hole.z! - hole.z!) < 1) {
      throw new Error("3D clicker tunnel didn't change direction");
    }
  }
  // A tilted cut: the model is turned so the cut lies flat, at the same object size.
  const sideways = cutFrameModel(cubeId, 90, 0);
  if (Math.abs(importedModel(sideways)!.height - importedModel(cubeId)!.height) > 0.01) {
    throw new Error("3D clicker cube turned on its side changed height");
  }
  const tiltedBuilds = [
    { modelCutTilt: 90, modelCutTurn: 0 },
    { modelCutTilt: 45, modelCutTurn: 30 },
    { modelCutTilt: 180, modelCutTurn: 0 },
  ].map((direction) => {
    const built = buildProduct("model-clicker", null, { ...settings, ...direction }, "preview");
    if (openEdges(built.text) || openEdges(built.base)) throw new Error(`3D clicker cut tilted ${direction.modelCutTilt}° is not watertight`);
    const editor = built.cutEditor;
    if (!editor) throw new Error("3D clicker preview has no cut editor");
    const normal = new THREE.Vector3(...editor.normal);
    const expected = new THREE.Vector3(
      Math.sin((direction.modelCutTilt * Math.PI) / 180) * Math.cos((direction.modelCutTurn * Math.PI) / 180),
      Math.sin((direction.modelCutTilt * Math.PI) / 180) * Math.sin((direction.modelCutTurn * Math.PI) / 180),
      Math.cos((direction.modelCutTilt * Math.PI) / 180),
    );
    if (normal.distanceTo(expected) > 1e-6) throw new Error("3D clicker cut editor faces the wrong way");
    // Every piece over the cut is on the cap's side of the shown plane.
    const point = new THREE.Vector3(...editor.point);
    for (const piece of editor.pieces) {
      const position = piece.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index += 97) {
        const side = new THREE.Vector3().fromBufferAttribute(position, index).sub(point).dot(normal);
        if (side < -0.05) throw new Error(`3D clicker piece tilted ${direction.modelCutTilt}° is under the cut`);
      }
    }
    return built;
  });
  const flatCube = new THREE.Box3().setFromBufferAttribute(preview.text.getAttribute("position") as THREE.BufferAttribute);
  const sideCube = new THREE.Box3().setFromBufferAttribute(tiltedBuilds[0].text.getAttribute("position") as THREE.BufferAttribute);
  if (Math.abs(sideCube.getSize(new THREE.Vector3()).y - flatCube.getSize(new THREE.Vector3()).y) > 0.5) {
    throw new Error("3D clicker cube cut sideways isn't the same size");
  }

  // A U: a cut through both prongs leaves two pieces over it. The biggest goes with the cap
  // on its own, the other stays on the housing, and either can be picked instead.
  const { Manifold: UKernel } = manifoldKernel();
  const base = UKernel.cube([100, 40, 30], true).translate(0, 0, 15);
  const left = UKernel.cube([40, 40, 40.1], true).translate(-30, 0, 50);
  const right = UKernel.cube([36, 40, 40.1], true).translate(31, 0, 50);
  const u = UKernel.union([base, left, right]);
  const uId = registerModel("U", solidPositions(u));
  for (const item of [base, left, right, u]) item.delete();
  const uSettings = { ...settings, modelId: uId, housingSize: 100, modelCut: 0.75 };
  const uAuto = buildProduct("model-clicker", null, uSettings, "preview");
  const uPieces = uAuto.cutEditor?.pieces ?? [];
  if (uPieces.length !== 2 || uPieces.filter((piece) => piece.cap).length !== 1) {
    throw new Error(`3D clicker U cut into ${uPieces.length} pieces with ${uPieces.filter((piece) => piece.cap).length} on the cap`);
  }
  const bigger = uPieces.find((piece) => piece.cap)!;
  const other = uPieces.find((piece) => !piece.cap)!;
  if (bigger.at.x > 0) throw new Error("3D clicker U didn't put the bigger prong on the cap");
  if (!bigger.outline.length || !other.outline.length) throw new Error("3D clicker U pieces have no outline");
  const uPrint = buildProduct("model-clicker", null, uSettings, "print");
  if (openEdges(uPrint.text) || openEdges(uPrint.base)) throw new Error("3D clicker U with a piece left on the housing is not watertight");
  const uOther = buildProduct("model-clicker", null, { ...uSettings, modelCutParts: [other.at] }, "preview");
  const switched = uOther.cutEditor!.pieces;
  if (!switched.find((piece) => piece.cap && piece.at.x > 0) || switched.filter((piece) => piece.cap).length !== 1) {
    throw new Error("3D clicker U didn't move the cap to the picked prong");
  }
  if (uOther.cut && uAuto.cut && Math.abs(uOther.cut.mm - uAuto.cut.mm) > 0.01) throw new Error("3D clicker U cut moved when picking a piece");
  const uBoth = buildProduct("model-clicker", null, { ...uSettings, modelCutParts: [other.at, bigger.at] }, "print");
  if (!uBoth.warnings.some((warning) => warning.includes("print loose"))) throw new Error("3D clicker U with both prongs didn't warn they're loose");
  if (openEdges(uBoth.text) || openEdges(uBoth.base)) throw new Error("3D clicker U with both prongs is not watertight");
  for (const built of [...tiltedBuilds, uAuto, uPrint, uOther, uBoth]) disposeModel(built);

  // Broken uploads are repaired: small gaps and loose bits welded, holes rebuilt.
  const box = (size: number, x = 0) => {
    const geometry = new THREE.BoxGeometry(size, size, size).toNonIndexed();
    geometry.translate(x, 0, size / 2);
    const positions = Float32Array.from(geometry.getAttribute("position").array);
    geometry.dispose();
    return positions;
  };
  const joined = (...parts: Float32Array[]) => {
    const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.length;
    }
    return all;
  };
  const gapped = box(40).map((value, index) => (index % 7 === 0 ? value + 1e-4 : value));
  const loose = joined(box(40), Float32Array.from([60, 0, 0, 70, 0, 0, 60, 10, 0]));
  const touching = joined(box(40), box(40, 40));
  const holed = box(40).slice(9);
  // Half the top missing and a cut-through slit in a side: the slit's edges don't pair up
  // into a clean loop, so it has to be rebuilt.
  const top = box(40);
  const broken = joined(top.slice(0, 9 * 4), top.slice(9 * 5));
  broken[0] += 3;
  const cases: [string, Float32Array, MeshRepair["kind"] | null, number][] = [
    ["clean", box(40), null, 64000],
    ["gapped", gapped, "welded", 64000],
    ["loose bit", loose, "welded", 64000],
    ["touching parts", touching, null, 128000],
    ["missing triangle", holed, "welded", 64000],
    ["torn", broken, "rebuilt", 64000],
  ];
  const { Manifold: Kernel, Mesh } = manifoldKernel();
  for (const [name, positions, kind, volume] of cases) {
    const started = performance.now();
    const fixed = await repairMesh(positions);
    if ((fixed.repair?.kind ?? null) !== kind) throw new Error(`Repairing a ${name} model gave ${fixed.repair?.kind ?? "nothing"}`);
    const triangles = Uint32Array.from({ length: fixed.positions.length / 3 }, (_, index) => index);
    const mesh = new Mesh({ numProp: 3, vertProperties: fixed.positions, triVerts: triangles });
    mesh.merge();
    const solid = new Kernel(mesh);
    const got = solid.volume();
    solid.delete();
    if (Math.abs(got - volume) > volume * 0.08) throw new Error(`Repaired ${name} model holds ${got.toFixed(0)} mm³, not ${volume}`);
    console.log(`  repaired ${name}: ${fixed.repair?.kind ?? "as is"}, ${Math.round(performance.now() - started)} ms`);
  }
  const rebuiltId = registerModel("Torn cube", (await repairMesh(broken)).positions, { kind: "rebuilt", detail: 0.3 });
  const rebuiltClicker = buildProduct("model-clicker", null, { ...settings, modelId: rebuiltId }, "print");
  if (openEdges(rebuiltClicker.text) || !rebuiltClicker.warnings.some((warning) => warning.includes("rebuilt"))) {
    throw new Error("Rebuilt 3D clicker model didn't cut cleanly or say it was rebuilt");
  }
  disposeModel(rebuiltClicker);

  const sample = buildProduct("model-clicker", null, product.settings, "preview");
  console.log("model-clicker cube", print.width.toFixed(1), "x", print.height.toFixed(1), "x", print.depth.toFixed(1), "sample from", least, "mm");
  for (const built of [print, preview, lower, straight, drilled, moved, ...tipped, sample]) disposeModel(built);
  cube.dispose();
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
