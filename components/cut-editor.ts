import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { ModelCutEditor } from "@/lib/geometry";
import { SurfaceMap, type CutSuggestion } from "@/lib/smart-fill";

// Turn rings about the global axes and an arrow that slides the cut along its normal, as in
// Blender's transform gizmo.
export type CutHandle = "x" | "y" | "z" | "move";

export const CUT_AXES: Record<Exclude<CutHandle, "move">, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const HANDLE_COLORS: Record<CutHandle, string> = { x: "#e5484d", y: "#30a46c", z: "#3e63dd", move: "#f5a524" };
const HOT = "#ffd84d";
// Mid tones, so the white smart-fill outline stands out on both.
const CAP = "#4b8ee6";
const HOUSING = "#8b8f98";
const UP = new THREE.Vector3(0, 0, 1);

// Tilt from flat and turn around the vertical (whole degrees) of a cut facing `normal`.
export function normalAngles(normal: THREE.Vector3) {
  const tilt = Math.round((Math.acos(Math.min(1, Math.max(-1, normal.z))) * 180) / Math.PI);
  if (tilt === 0 || tilt === 180) return { tilt, turn: 0 };
  const turn = Math.round(((Math.atan2(normal.y, normal.x) * 180) / Math.PI + 360) % 360) % 360;
  return { tilt, turn };
}

type Handle = { visuals: THREE.Mesh[]; pick: THREE.Mesh };

// The uncut model upright with the cut through it, the pieces over the cut to pick for the
// cap, and the gizmo. Lives in the viewer's model space (z up, mm).
export class CutEditor {
  readonly group = new THREE.Group();
  readonly gizmo = new THREE.Group();
  readonly normal = new THREE.Vector3(0, 0, 1);
  readonly point = new THREE.Vector3();
  // Whether the pieces were built for the plane shown.
  fresh = false;
  private data: ModelCutEditor | null = null;
  private readonly clipAbove = new THREE.Plane();
  private readonly clipBelow = new THREE.Plane();
  private readonly below: THREE.Mesh;
  private readonly above: THREE.Mesh;
  private readonly pieceGroup = new THREE.Group();
  private pieces: THREE.Mesh[] = [];
  private readonly disc: THREE.Mesh;
  private readonly rim: THREE.LineLoop;
  private readonly outline: LineSegments2;
  private readonly outlineMaterial: LineMaterial;
  private readonly arrow = new THREE.Group();
  private readonly handles: Record<CutHandle, Handle>;
  private readonly center = new THREE.Vector3();
  private radius = 10;
  private hoverHandle: CutHandle | null = null;
  private hoverPiece = -1;
  private activeHandle: CutHandle | null = null;
  private readonly disposables: { dispose(): void }[] = [];
  // Smart fill: regions of the uncut model split at sharp edges.
  private surface: { key: string; map: SurfaceMap } | null = null;
  private fillAngle = 30;
  private usedAngle: { map: SurfaceMap; asked: number; angle: number } | null = null;
  private hoverRegion = -1;
  private readonly regionOutline: LineSegments2;
  private readonly regionOutlineMaterial: LineMaterial;
  private readonly regionFill: THREE.Mesh;

  constructor() {
    // Pushed back a little so outlines drawn on their edges show through.
    const solid = (color: string, clip: THREE.Plane) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.48,
        metalness: 0.02,
        side: THREE.DoubleSide,
        clippingPlanes: [clip],
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    this.below = new THREE.Mesh(new THREE.BufferGeometry(), solid(HOUSING, this.clipBelow));
    this.above = new THREE.Mesh(new THREE.BufferGeometry(), solid(CAP, this.clipAbove));
    this.below.castShadow = true;
    this.above.castShadow = true;

    const discMaterial = new THREE.MeshBasicMaterial({
      color: "#3b82f6",
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), discMaterial);
    const rimPoints = Array.from({ length: 96 }, (_, index) => {
      const angle = (index / 96) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    });
    this.rim = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(rimPoints),
      new THREE.LineBasicMaterial({ color: "#3b82f6", transparent: true, opacity: 0.7 }),
    );
    this.disc.renderOrder = 5;

    this.outlineMaterial = new LineMaterial({ color: HOT, linewidth: 3, depthTest: false, transparent: true });
    this.outline = new LineSegments2(new LineSegmentsGeometry(), this.outlineMaterial);
    this.outline.renderOrder = 15;
    this.outline.visible = false;

    this.regionOutlineMaterial = new LineMaterial({ color: "#ffffff", linewidth: 3.5 });
    this.regionOutline = new LineSegments2(new LineSegmentsGeometry(), this.regionOutlineMaterial);
    this.regionOutline.renderOrder = 12;
    this.regionOutline.visible = false;
    this.regionFill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.regionFill.renderOrder = 11;
    this.regionFill.visible = false;

    const overlay = (color: string) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const ring = (axis: "x" | "y" | "z"): Handle => {
      const turn = (geometry: THREE.BufferGeometry) => {
        if (axis === "x") geometry.rotateY(Math.PI / 2);
        if (axis === "y") geometry.rotateX(Math.PI / 2);
        return geometry;
      };
      const visual = new THREE.Mesh(turn(new THREE.TorusGeometry(1, 0.02, 8, 128)), overlay(HANDLE_COLORS[axis]));
      const pick = new THREE.Mesh(turn(new THREE.TorusGeometry(1, 0.11, 6, 64)), hidden);
      return { visuals: [visual], pick };
    };
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.86, 12).rotateX(Math.PI / 2).translate(0, 0, 0.55),
      overlay(HANDLE_COLORS.move),
    );
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.24, 24).rotateX(Math.PI / 2).translate(0, 0, 1.1),
      overlay(HANDLE_COLORS.move),
    );
    const arrowPick = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.15, 8).rotateX(Math.PI / 2).translate(0, 0, 0.66), hidden);
    this.arrow.add(shaft, tip, arrowPick);
    this.handles = { x: ring("x"), y: ring("y"), z: ring("z"), move: { visuals: [shaft, tip], pick: arrowPick } };
    for (const [name, handle] of Object.entries(this.handles) as [CutHandle, Handle][]) {
      handle.pick.userData.handle = name;
      for (const visual of handle.visuals) visual.renderOrder = 20;
      if (name !== "move") this.gizmo.add(...handle.visuals, handle.pick);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), overlay("#ffffff"));
    dot.renderOrder = 21;
    this.gizmo.add(this.arrow, dot);

    this.group.add(
      this.below,
      this.above,
      this.pieceGroup,
      this.regionFill,
      this.regionOutline,
      this.disc,
      this.rim,
      this.outline,
      this.gizmo,
    );
    this.gizmo.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) this.disposables.push(mesh.geometry, mesh.material as THREE.Material);
    });
    this.disposables.push(
      this.below.material as THREE.Material,
      this.above.material as THREE.Material,
      this.disc.geometry,
      discMaterial,
      this.rim.geometry,
      this.rim.material as THREE.Material,
      this.outline.geometry,
      this.outlineMaterial,
      this.regionOutlineMaterial,
      this.regionFill.material as THREE.Material,
    );
  }

  get unit() {
    return this.data?.unit ?? 1;
  }

  // The same model comes back with every build, so the regions are kept while it matches.
  private surfaceMap() {
    const position = this.data?.source.getAttribute("position");
    if (!position) return null;
    const array = position.array as Float32Array;
    const key = `${array.length}:${array[0]}:${array[array.length >> 1]}:${array[array.length - 1]}`;
    if (this.surface?.key !== key) this.surface = { key, map: new SurfaceMap(array) };
    return this.surface.map;
  }

  setFillAngle(angle: number) {
    if (angle === this.fillAngle) return;
    this.fillAngle = angle;
    this.setRegionHover(-1);
  }

  // The angle the regions use: the one asked for, or less when that leaves one region
  // covering most of the model (smooth or low-poly models), which can't be cut off.
  get usedFillAngle() {
    const map = this.surfaceMap();
    if (!map) return this.fillAngle;
    if (this.usedAngle?.map === map && this.usedAngle.asked === this.fillAngle) return this.usedAngle.angle;
    let angle = this.fillAngle;
    for (; angle > 2; angle -= 1) {
      const labels = map.labels(angle);
      const areas = new Map<number, number>();
      let largest = 0;
      for (let face = 0; face < map.faceCount; face += 1) {
        const area = (areas.get(labels[face]) ?? 0) + map.areas[face];
        areas.set(labels[face], area);
        if (area > largest) largest = area;
      }
      if (largest <= map.totalArea * 0.85) break;
    }
    this.usedAngle = { map, asked: this.fillAngle, angle };
    return angle;
  }

  // The smart-fill region under the pointer, or -1.
  pickRegion(raycaster: THREE.Raycaster) {
    if (!this.data) return -1;
    const hit = raycaster.intersectObject(this.below, false)[0];
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return -1;
    const map = this.surfaceMap();
    return map ? map.labels(this.usedFillAngle)[hit.faceIndex] : -1;
  }

  setRegionHover(region: number) {
    if (region === this.hoverRegion) return;
    this.hoverRegion = region;
    const map = region >= 0 ? this.surfaceMap() : null;
    if (!map) {
      this.regionOutline.visible = false;
      this.regionFill.visible = false;
      return;
    }
    const labels = map.labels(this.usedFillAngle);
    this.regionOutline.geometry.dispose();
    const outline = new LineSegmentsGeometry();
    const segments = map.outline(labels, region);
    if (segments.length) outline.setPositions(segments);
    this.regionOutline.geometry = outline;
    this.regionOutline.visible = segments.length > 0;
    this.regionFill.geometry.dispose();
    const fill = new THREE.BufferGeometry();
    fill.setAttribute("position", new THREE.BufferAttribute(map.triangles(labels, region), 3));
    this.regionFill.geometry = fill;
    this.regionFill.visible = true;
  }

  // A flat cut that takes the region off as the cap, in the editor's mm.
  suggestCut(region: number): CutSuggestion | null {
    const map = this.surfaceMap();
    return map ? map.suggestCut(map.labels(this.usedFillAngle), region) : null;
  }

  get hasSource() {
    return this.data !== null;
  }

  get sourceMesh() {
    return this.below;
  }

  // New build: its source and pieces, which match the plane it was built with.
  setData(data: ModelCutEditor | null) {
    if (data === this.data) return;
    this.data = data;
    for (const piece of this.pieces) (piece.material as THREE.Material).dispose();
    this.pieceGroup.clear();
    this.pieces = [];
    this.hoverPiece = -1;
    this.setRegionHover(-1);
    if (!data) {
      this.fresh = false;
      return;
    }
    this.below.geometry = data.source;
    this.above.geometry = data.source;
    data.source.computeBoundingBox();
    const box = data.source.boundingBox!;
    box.getCenter(this.center);
    this.radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    this.pieces = data.pieces.map((piece) => {
      const mesh = new THREE.Mesh(
        piece.geometry,
        new THREE.MeshStandardMaterial({
          color: piece.cap ? CAP : HOUSING,
          roughness: 0.46,
          metalness: 0.02,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      mesh.castShadow = true;
      return mesh;
    });
    if (this.pieces.length) this.pieceGroup.add(...this.pieces);
    this.fresh = true;
    this.refresh();
  }

  markStale() {
    this.fresh = false;
    this.hoverPiece = -1;
    this.refresh();
  }

  setPlane(normal: THREE.Vector3, point: THREE.Vector3) {
    this.normal.copy(normal).normalize();
    this.point.copy(point);
  }

  // Lowest and highest reach of the model along `normal`.
  extent(normal: THREE.Vector3) {
    const position = this.data?.source.getAttribute("position");
    if (!position) return [0, 1] as const;
    let low = Infinity;
    let high = -Infinity;
    const array = position.array as ArrayLike<number>;
    for (let index = 0; index < array.length; index += 3) {
      const along = array[index] * normal.x + array[index + 1] * normal.y + array[index + 2] * normal.z;
      if (along < low) low = along;
      if (along > high) high = along;
    }
    return [low, high] as const;
  }

  // Where the plane meets the line up through the model's middle along its normal.
  planeCenter(normal = this.normal, point = this.point) {
    return this.center.clone().addScaledVector(normal, point.clone().sub(this.center).dot(normal));
  }

  // Keeps clipping and the gizmo's on-screen size in step with the camera; call every frame.
  update(camera: THREE.Camera, viewport: { width: number; height: number }) {
    this.group.updateWorldMatrix(true, false);
    const world = this.group.matrixWorld;
    this.clipAbove.setFromNormalAndCoplanarPoint(this.normal, this.point).applyMatrix4(world);
    this.clipBelow.setFromNormalAndCoplanarPoint(this.normal.clone().negate(), this.point).applyMatrix4(world);
    const center = this.planeCenter();
    const facing = new THREE.Quaternion().setFromUnitVectors(UP, this.normal);
    this.disc.position.copy(center);
    this.disc.quaternion.copy(facing);
    this.disc.scale.setScalar(this.radius * 1.08);
    this.rim.position.copy(center);
    this.rim.quaternion.copy(facing);
    this.rim.scale.setScalar(this.radius * 1.08);
    this.gizmo.position.copy(center);
    this.arrow.quaternion.copy(facing);
    const distance = camera.position.distanceTo(this.gizmo.getWorldPosition(new THREE.Vector3()));
    this.gizmo.scale.setScalar(distance * 0.12);
    this.outlineMaterial.resolution.set(viewport.width, viewport.height);
    this.regionOutlineMaterial.resolution.set(viewport.width, viewport.height);
  }

  pickHandle(raycaster: THREE.Raycaster): CutHandle | null {
    const hit = raycaster.intersectObjects(
      Object.values(this.handles).map((handle) => handle.pick),
      false,
    )[0];
    return (hit?.object.userData.handle as CutHandle | undefined) ?? null;
  }

  // The piece under the pointer, unless the housing below the cut is in front of it.
  pickPiece(raycaster: THREE.Raycaster) {
    if (!this.fresh || !this.pieces.length) return -1;
    for (const hit of raycaster.intersectObjects([...this.pieces, this.below], false)) {
      if (hit.object === this.below) {
        const local = this.group.worldToLocal(hit.point.clone());
        if (local.sub(this.point).dot(this.normal) > 0.05) continue;
        return -1;
      }
      return this.pieces.indexOf(hit.object as THREE.Mesh);
    }
    return -1;
  }

  setHover(handle: CutHandle | null, piece: number) {
    if (handle === this.hoverHandle && piece === this.hoverPiece) return;
    this.hoverHandle = handle;
    this.hoverPiece = piece;
    this.refresh();
  }

  setActive(handle: CutHandle | null) {
    this.activeHandle = handle;
    this.refresh();
  }

  private refresh() {
    const showPieces = this.fresh && this.pieces.length > 0;
    this.pieceGroup.visible = showPieces;
    this.above.visible = !showPieces;
    for (const [name, handle] of Object.entries(this.handles) as [CutHandle, Handle][]) {
      const hot = name === (this.activeHandle ?? this.hoverHandle);
      for (const visual of handle.visuals) (visual.material as THREE.MeshBasicMaterial).color.set(hot ? HOT : HANDLE_COLORS[name]);
    }
    this.pieces.forEach((mesh, index) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const hovered = index === this.hoverPiece;
      material.color.set(this.data?.pieces[index]?.cap ? CAP : HOUSING);
      if (hovered) material.color.lerp(new THREE.Color(HOT), 0.6);
      material.emissive.set(hovered ? HOT : "#000000");
      material.emissiveIntensity = hovered ? 0.18 : 0;
    });
    const piece = showPieces && this.hoverPiece >= 0 ? this.data?.pieces[this.hoverPiece] : undefined;
    if (!piece) {
      this.outline.visible = false;
      return;
    }
    const segments: number[] = [];
    for (const ring of piece.outline) {
      const count = ring.length / 3;
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        segments.push(ring[index * 3], ring[index * 3 + 1], ring[index * 3 + 2], ring[next * 3], ring[next * 3 + 1], ring[next * 3 + 2]);
      }
    }
    this.outline.geometry.dispose();
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(segments);
    this.outline.geometry = geometry;
    this.outline.visible = segments.length > 0;
  }

  dispose() {
    for (const piece of this.pieces) (piece.material as THREE.Material).dispose();
    for (const item of this.disposables) item.dispose();
    this.outline.geometry.dispose();
    this.regionOutline.geometry.dispose();
    this.regionFill.geometry.dispose();
  }
}
