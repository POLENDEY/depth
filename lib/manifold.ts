import type { ManifoldToplevel } from "manifold-3d";

export type Kernel = ManifoldToplevel;
export type Solid = InstanceType<ManifoldToplevel["Manifold"]>;

let ready: ManifoldToplevel | null = null;
let loading: Promise<ManifoldToplevel> | null = null;

// The solid-geometry kernel is WebAssembly, so it loads once before the first cut.
// In the browser its .wasm is served from /public (copied there on install).
export function ensureManifold() {
  loading ??= (async () => {
    const { default: Module } = await import("manifold-3d");
    const kernel = await Module(typeof window === "undefined" ? undefined : { locateFile: () => "/manifold.wasm" });
    kernel.setup();
    ready = kernel;
    return kernel;
  })();
  return loading;
}

export function manifoldKernel() {
  if (!ready) throw new Error("The 3D cutting tools are still loading. Try again in a moment.");
  return ready;
}

const NOT_SOLID =
  "This model isn't a closed solid (it has gaps or loose surfaces), so it can't be cut into a clicker. Repair it in your 3D app or slicer and upload it again.";

// Triangle soup to a solid, welding corners that match to 0.1 µm.
function toSolid(positions: Float32Array) {
  const { Manifold, Mesh } = manifoldKernel();
  const keys = new Map<string, number>();
  const vertices: number[] = [];
  const triangles = new Uint32Array(positions.length / 3);
  const snap = (value: number) => Math.round(value * 1e4);
  for (let corner = 0; corner < positions.length / 3; corner += 1) {
    const x = positions[corner * 3];
    const y = positions[corner * 3 + 1];
    const z = positions[corner * 3 + 2];
    const key = `${snap(x)},${snap(y)},${snap(z)}`;
    let index = keys.get(key);
    if (index === undefined) {
      index = vertices.length / 3;
      keys.set(key, index);
      vertices.push(x, y, z);
    }
    triangles[corner] = index;
  }
  const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(vertices), triVerts: triangles });
  mesh.merge();
  let solid: Solid;
  try {
    solid = new Manifold(mesh);
  } catch {
    throw new Error(NOT_SOLID);
  }
  if (solid.status() !== "NoError" || solid.isEmpty()) {
    solid.delete();
    throw new Error(NOT_SOLID);
  }
  return solid;
}

const solids = new Map<string, Solid>();

// Kept solids are reused across rebuilds; the oldest are freed past a few.
function remember(key: string, make: () => Solid) {
  const cached = solids.get(key);
  if (cached) return cached;
  const solid = make();
  solids.set(key, solid);
  while (solids.size > 8) {
    const [oldest, old] = solids.entries().next().value!;
    solids.delete(oldest);
    old.delete();
  }
  return solid;
}

const PREVIEW_TRIANGLES = 120_000;

// The model as a solid. The preview gets a simplified copy when it's very detailed.
export function modelSolid(id: string, positions: Float32Array, preview: boolean) {
  const full = remember(id, () => toSolid(positions));
  if (!preview || full.numTri() <= PREVIEW_TRIANGLES) return full;
  return remember(`${id}:lite`, () => full.simplify(0.15));
}

// `ring` makes it a curved tunnel that dips under the surface and comes back out, instead
// of a straight bore: a torus of that radius with its lowest point at (u, v), stood
// upright and then tipped and turned (degrees) as in `tunnelPoint`.
export type Drill = {
  axis: "x" | "y";
  u: number;
  v: number;
  radius: number;
  ring?: number;
  depth?: number;
  tilt?: number;
  turn?: number;
};

// The solid with a round hole along `axis`, at `u` across and `v` up: bored straight
// through, or a curved tunnel when `ring` is set.
export function drilled(key: string, solid: Solid, drill: Drill, length: number) {
  const tilt = drill.tilt ?? 0;
  const turn = drill.turn ?? 0;
  const depth = drill.depth ?? 0;
  const shape = drill.ring ? `ring${drill.ring.toFixed(3)}:${tilt}:${turn}:${depth.toFixed(3)}` : "straight";
  return remember(`${key}:${drill.axis}:${shape}:${drill.u.toFixed(3)}:${drill.v.toFixed(3)}:${drill.radius.toFixed(4)}`, () => {
    const { CrossSection, Manifold } = manifoldKernel();
    if (drill.ring) {
      const tube = CrossSection.circle(drill.radius, 32);
      const offset = tube.translate([drill.ring, 0]);
      const torus = offset.revolve(64);
      const upright = drill.axis === "x" ? torus.rotate(0, 90, 0) : torus.rotate(90, 0, 0);
      const raised = upright.translate(0, 0, drill.ring);
      const tipped = drill.axis === "x" ? raised.rotate(0, tilt, 0) : raised.rotate(tilt, 0, 0);
      const turned = tipped.rotate(0, 0, turn);
      const placed = drill.axis === "x" ? turned.translate(depth, drill.u, drill.v) : turned.translate(drill.u, depth, drill.v);
      const cut = solid.subtract(placed);
      for (const item of [tube, offset, torus, upright, raised, tipped, turned, placed]) item.delete();
      return cut;
    }
    const bore = Manifold.cylinder(length, drill.radius, drill.radius, 48, true);
    const turned = drill.axis === "x" ? bore.rotate(0, 90, 0) : bore.rotate(90, 0, 0);
    const placed = drill.axis === "x" ? turned.translate(0, drill.u, drill.v) : turned.translate(drill.u, 0, drill.v);
    const cut = solid.subtract(placed);
    for (const item of [bore, turned, placed]) item.delete();
    return cut;
  });
}

// A solid's triangles as a flat position array.
export function solidPositions(solid: Solid) {
  const mesh = solid.getMesh();
  const out = new Float32Array(mesh.triVerts.length * 3);
  for (let corner = 0; corner < mesh.triVerts.length; corner += 1) {
    const at = mesh.triVerts[corner] * mesh.numProp;
    out[corner * 3] = mesh.vertProperties[at];
    out[corner * 3 + 1] = mesh.vertProperties[at + 1];
    out[corner * 3 + 2] = mesh.vertProperties[at + 2];
  }
  return out;
}
