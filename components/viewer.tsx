"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  hasLineColors,
  LIMITS,
  textSlotColors,
  type CharmBox,
  type CharmPlacement,
  type KeychainModel,
  type ModelAssembly,
} from "@/lib/geometry";
import type { Pt3 } from "@/lib/catalog";
import { cutNormal } from "@/lib/model-import";
import { CUT_AXES, CutEditor, normalAngles, type CutHandle } from "./cut-editor";

type ViewerApi = {
  textMesh: THREE.Mesh;
  baseMesh: THREE.Mesh;
  textMat: THREE.MeshStandardMaterial;
  baseMat: THREE.MeshStandardMaterial;
  dimensionGroup: THREE.Group;
  modelRoot: THREE.Group;
  frame: (reset: boolean) => void;
  // The housing and cap apart, for the fit animation.
  housingText: THREE.Mesh;
  housingBase: THREE.Mesh;
  capText: THREE.Mesh;
  capBase: THREE.Mesh;
  capGroup: THREE.Group;
  fitGroup: THREE.Group;
  fit: { assembly: ModelAssembly | null; start: number };
  cutEditor: CutEditor;
  editing: { on: boolean; dragging: boolean };
};

// The cap's path in the fit animation (seconds in): up off the bed, over the housing, down
// onto the switch, then clicking over and over.
function capPose(time: number, assembly: ModelAssembly, out: THREE.Vector3) {
  const { offset, press } = assembly;
  const hover = offset.z + 14;
  const ease = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
  };
  if (time < 0.8) return out.set(0, 0, hover * ease(time / 0.8));
  if (time < 2) {
    const k = ease((time - 0.8) / 1.2);
    return out.set(offset.x * k, offset.y * k, hover);
  }
  if (time < 2.9) return out.set(offset.x, offset.y, hover + (offset.z - hover) * ease((time - 2) / 0.9));
  const beat = (time - 2.9) % 1.1;
  const down = beat < 0.16 ? ease(beat / 0.16) : beat < 0.3 ? 1 : beat < 0.5 ? 1 - ease((beat - 0.3) / 0.2) : 0;
  return out.set(offset.x, offset.y, offset.z - press * down);
}

const TOOL =
  "inline-flex items-center gap-1.5 rounded-full border border-[#e6e7ec] px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur";

type ViewerProps = {
  model: KeychainModel | null;
  textColor: string;
  baseColor: string;
  lineColors?: string[];
  charms?: CharmPlacement[];
  onCharmMove?: (index: number, x: number, y: number) => void;
  holeX?: number;
  holeY?: number;
  onHoleMove?: (x: number, y: number) => void;
  onCutMove?: (mm: number) => void;
  // The cut's direction (degrees) and spot (share of the height along it), to tilt in place.
  cutTilt?: number;
  cutTurn?: number;
  cutShare?: number;
  onCutTransform?: (tilt: number, turn: number, share: number) => void;
  // Index into the model's cut editor pieces: clicked to go with the cap or not.
  onCutPiece?: (index: number) => void;
  // A clicked smart-fill region: the cut that takes it off, and a point on it (upload units)
  // that picks its piece for the cap.
  onCutPick?: (tilt: number, turn: number, share: number, at: Pt3) => void;
  showDimensions?: boolean;
  onToggleDimensions?: () => void;
};

type DragInfo = {
  charmBounds: CharmBox[];
  charms: CharmPlacement[];
  onCharmMove?: (index: number, x: number, y: number) => void;
  hole: KeychainModel["hole"];
  holeX: number;
  holeY: number;
  onHoleMove?: (x: number, y: number) => void;
  cut: KeychainModel["cut"];
  onCutMove?: (mm: number) => void;
  onCutTransform?: (tilt: number, turn: number, share: number) => void;
  onCutPiece?: (index: number) => void;
  onCutPick?: (tilt: number, turn: number, share: number, at: Pt3) => void;
  onCutReadout?: (text: string | null) => void;
  cutTilt?: number;
  cutTurn?: number;
  cutShare?: number;
  // Puts the shown cut back where the settings say.
  syncCut?: () => void;
};

// Shown directions into the upload's, when the part is shown turned.
function unturn(basis: number[] | undefined, vector: THREE.Vector3) {
  if (!basis) return vector;
  const { x, y, z } = vector;
  return vector.set(
    basis[0] * x + basis[1] * y + basis[2] * z,
    basis[3] * x + basis[4] * y + basis[5] * z,
    basis[6] * x + basis[7] * y + basis[8] * z,
  );
}

// The upload's directions into shown ones (the basis transposed).
function returnTurn(basis: number[] | undefined, vector: THREE.Vector3) {
  if (!basis) return vector;
  const { x, y, z } = vector;
  return vector.set(
    basis[0] * x + basis[3] * y + basis[6] * z,
    basis[1] * x + basis[4] * y + basis[7] * z,
    basis[2] * x + basis[5] * y + basis[8] * z,
  );
}

export function Viewer({
  model,
  textColor,
  baseColor,
  lineColors,
  charms = [],
  onCharmMove,
  holeX = 0,
  holeY = 0,
  onHoleMove,
  onCutMove,
  cutTilt = 0,
  cutTurn = 0,
  cutShare = 0.4,
  onCutTransform,
  onCutPiece,
  onCutPick,
  showDimensions = false,
  onToggleDimensions,
}: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const lineMatsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const [playing, setPlaying] = useState(false);
  const [editingCut, setEditingCut] = useState(false);
  const [cutReadout, setCutReadout] = useState<string | null>(null);
  const [fillAngle, setFillAngle] = useState(30);
  const fillAngleRef = useRef(fillAngle);
  const fillNoteRef = useRef<HTMLSpanElement>(null);
  const canEditCut = Boolean(model?.cutEditor && onCutTransform);
  const editing = editingCut && canEditCut;
  // The shown cut follows the settings, using the built plane once the build matches.
  const syncCut = useCallback(() => {
    const api = apiRef.current;
    if (!api || api.editing.dragging) return;
    const data = model?.cutEditor ?? null;
    api.cutEditor.setData(data);
    if (!data) return;
    const normal = cutNormal(cutTilt, cutTurn);
    const built = api.cutEditor.fresh && data.tilt === cutTilt && data.turn === cutTurn;
    if (!built && api.cutEditor.fresh) api.cutEditor.markStale();
    let point: THREE.Vector3;
    if (built) point = new THREE.Vector3(...data.point);
    else {
      const [low, high] = api.cutEditor.extent(normal);
      point = normal.clone().multiplyScalar(low + cutShare * (high - low));
    }
    api.cutEditor.setPlane(normal, point);
  }, [model, cutTilt, cutTurn, cutShare]);
  useEffect(() => syncCut(), [syncCut]);
  const dragRef = useRef<DragInfo>({
    charmBounds: [],
    charms: [],
    hole: null,
    holeX: 0,
    holeY: 0,
    cut: undefined,
  });
  useEffect(() => {
    dragRef.current = {
      charmBounds: model?.charmBounds ?? [],
      charms,
      onCharmMove,
      hole: model?.hole ?? null,
      holeX,
      holeY,
      onHoleMove,
      cut: model?.cut,
      onCutMove,
      onCutTransform,
      onCutPiece,
      onCutPick,
      onCutReadout: setCutReadout,
      cutTilt,
      cutTurn,
      cutShare,
      syncCut,
    };
  }, [model, charms, onCharmMove, holeX, holeY, onHoleMove, onCutMove, onCutTransform, onCutPiece, onCutPick, cutTilt, cutTurn, cutShare, syncCut]);
  useEffect(() => {
    fillAngleRef.current = fillAngle;
    apiRef.current?.cutEditor.setFillAngle(fillAngle);
  }, [fillAngle]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0xfbfbfd, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);
    renderer.domElement.className = "h-full w-full touch-none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
    camera.position.set(40, 36, 90);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minDistance = 18;
    controls.maxDistance = 1600;
    // Blender: middle-drag orbits, Shift+middle-drag pans, scroll zooms.
    // Left-drag also orbits, and Shift+left-drag pans, for mice without a middle button.
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    const blockMiddleClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    renderer.domElement.addEventListener("mousedown", blockMiddleClick);
    renderer.domElement.addEventListener("auxclick", blockMiddleClick);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd5dbe6, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.35);
    key.position.set(48, 92, 36);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 280;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xeef1ff, 0.7);
    fill.position.set(-36, 24, -28);
    scene.add(fill);

    const grid = new THREE.GridHelper(260, 26, 0xd5dae4, 0xe6eaf1);
    scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.ShadowMaterial({ opacity: 0.14 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    scene.add(floor);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    const textMat = new THREE.MeshStandardMaterial({
      color: "#f4f4f5",
      roughness: 0.46,
      metalness: 0.03,
    });
    const baseMat = new THREE.MeshStandardMaterial({
      color: "#8b78f2",
      roughness: 0.52,
      metalness: 0.02,
    });
    const textMesh = new THREE.Mesh(new THREE.BufferGeometry(), textMat);
    const baseMesh = new THREE.Mesh(new THREE.BufferGeometry(), baseMat);
    const dimensionGroup = new THREE.Group();
    textMesh.castShadow = true;
    baseMesh.castShadow = true;
    textMesh.visible = false;
    baseMesh.visible = false;
    modelRoot.add(baseMesh, textMesh, dimensionGroup);
    const partMesh = (material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.castShadow = true;
      return mesh;
    };
    const housingText = partMesh(textMat);
    const housingBase = partMesh(baseMat);
    const capText = partMesh(textMat);
    const capBase = partMesh(baseMat);
    const capGroup = new THREE.Group();
    capGroup.add(capText, capBase);
    const fitGroup = new THREE.Group();
    fitGroup.add(housingText, housingBase, capGroup);
    fitGroup.visible = false;
    modelRoot.add(fitGroup);
    const fit = { assembly: null as ModelAssembly | null, start: 0 };
    const cutEditor = new CutEditor();
    cutEditor.group.visible = false;
    modelRoot.add(cutEditor.group);
    const editing = { on: false, dragging: false };
    const viewport = { width: 1, height: 1 };

    let userMoved = false;
    const framedCenter = new THREE.Vector3();
    const onStart = () => {
      userMoved = true;
    };
    controls.addEventListener("start", onStart);

    const frame = (reset: boolean) => {
      if (reset) userMoved = false;
      modelRoot.rotation.order = "XYZ";
      modelRoot.rotation.set(-Math.PI / 2, 0, 0);
      modelRoot.position.set(0, 0, 0);
      modelRoot.updateWorldMatrix(true, true);
      const shown = () =>
        editing.on && cutEditor.hasSource
          ? new THREE.Box3().setFromObject(cutEditor.sourceMesh)
          : new THREE.Box3().setFromObject(baseMesh).union(new THREE.Box3().setFromObject(textMesh));
      const raw = shown();
      if (raw.isEmpty()) return;
      modelRoot.position.y -= raw.min.y;
      modelRoot.updateWorldMatrix(true, true);
      const placed = shown();
      const center = placed.getCenter(new THREE.Vector3());
      const size = placed.getSize(new THREE.Vector3());
      // The cut's disc reaches past the model's corners, so the editor frames all of it.
      if (editing.on && cutEditor.hasSource) size.setScalar(size.length() * 0.95);
      const radius = Math.max(size.x, size.y, size.z) * 0.62 || 20;
      if (!userMoved) {
        const verticalFov = (camera.fov * Math.PI) / 180;
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.2));
        const span = Math.max(size.x, size.y, size.z) * 0.62;
        const distance = Math.max(span / Math.tan(verticalFov / 2), span / Math.tan(horizontalFov / 2));
        camera.position.set(center.x + distance * 0.04, center.y + distance * 0.48, center.z + distance * 0.82);
        controls.target.copy(center);
      } else {
        const panOffset = controls.target.clone().sub(framedCenter);
        const viewOffset = camera.position.clone().sub(controls.target);
        controls.target.copy(center).add(panOffset);
        camera.position.copy(controls.target).add(viewOffset);
      }
      framedCenter.copy(center);
      camera.near = Math.max(0.1, radius / 40);
      camera.far = radius * 50;
      camera.updateProjectionMatrix();
      key.shadow.camera.left = -radius * 2.2;
      key.shadow.camera.right = radius * 2.2;
      key.shadow.camera.top = radius * 2.2;
      key.shadow.camera.bottom = -radius * 2.2;
      key.shadow.camera.updateProjectionMatrix();
      controls.update();
    };

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      viewport.width = width;
      viewport.height = height;
      frame(false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loop = () => {
      if (fit.assembly) capPose(performance.now() / 1000 - fit.start, fit.assembly, capGroup.position);
      controls.update();
      if (editing.on) {
        if (hoverEvent && !gizmoDrag.active) hover(hoverEvent);
        hoverEvent = null;
        cutEditor.update(camera, viewport);
      }
      renderer.render(scene, camera);
    };
    const onVisibility = () => {
      renderer.setAnimationLoop(document.hidden ? null : loop);
    };
    document.addEventListener("visibilitychange", onVisibility);
    renderer.setAnimationLoop(loop);

    apiRef.current = {
      textMesh,
      baseMesh,
      textMat,
      baseMat,
      dimensionGroup,
      modelRoot,
      frame,
      housingText,
      housingBase,
      capText,
      capBase,
      capGroup,
      fitGroup,
      fit,
      cutEditor,
      editing,
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = {
      active: false,
      target: "charm" as "charm" | "hole" | "cut",
      charmIndex: -1,
      pointerId: -1,
      startLocal: new THREE.Vector3(),
      startX: 0,
      startY: 0,
      plane: new THREE.Plane(),
      hit: new THREE.Vector3(),
    };

    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    };

    // The cut editor: a ring turns the cut about its axis, the arrow slides it, and a click
    // on a piece over the cut picks it for the cap (or puts it back on the housing).
    const gizmoDrag = {
      active: false,
      handle: "move" as CutHandle,
      pointerId: -1,
      startNormal: new THREE.Vector3(),
      center: new THREE.Vector3(),
      lastAngle: 0,
      turned: 0,
      startAlong: 0,
      range: [0, 1] as readonly [number, number],
    };
    const click = { pointerId: -1, x: 0, y: 0 };
    let hoverEvent: PointerEvent | null = null;
    // The pointer's angle around a point's spot on screen, counterclockwise.
    const screenAngle = (event: PointerEvent, center: THREE.Vector3) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const shown = modelRoot.localToWorld(center.clone()).project(camera);
      const x = rect.left + ((shown.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - shown.y) / 2) * rect.height;
      return Math.atan2(y - event.clientY, event.clientX - x);
    };
    // How far along the line through `center` facing `normal` the pointer's ray passes closest.
    const alongLine = (center: THREE.Vector3, normal: THREE.Vector3) => {
      const ray = raycaster.ray.clone().applyMatrix4(modelRoot.matrixWorld.clone().invert());
      const lean = normal.dot(ray.direction);
      const square = 1 - lean * lean;
      if (square < 1e-4) return null;
      const toCenter = center.clone().sub(ray.origin);
      return (lean * ray.direction.dot(toCenter) - normal.dot(toCenter)) / square;
    };
    const onEditorDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey) return;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const handle = cutEditor.pickHandle(raycaster);
      if (!handle) {
        click.pointerId = event.pointerId;
        click.x = event.clientX;
        click.y = event.clientY;
        return;
      }
      gizmoDrag.active = true;
      gizmoDrag.handle = handle;
      gizmoDrag.pointerId = event.pointerId;
      gizmoDrag.startNormal.copy(cutEditor.normal);
      gizmoDrag.center.copy(cutEditor.planeCenter());
      if (handle === "move") {
        gizmoDrag.startAlong = alongLine(gizmoDrag.center, gizmoDrag.startNormal) ?? 0;
        gizmoDrag.range = cutEditor.extent(gizmoDrag.startNormal);
      } else {
        gizmoDrag.lastAngle = screenAngle(event, gizmoDrag.center);
        gizmoDrag.turned = 0;
      }
      editing.dragging = true;
      cutEditor.setActive(handle);
      userMoved = true;
      controls.enabled = false;
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onGizmoMove = (event: PointerEvent) => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const info = dragRef.current;
      const { center, startNormal, handle } = gizmoDrag;
      if (handle === "move") {
        const along = alongLine(center, startNormal);
        if (along === null) return;
        const [low, high] = gizmoDrag.range;
        const span = Math.max(high - low, 1e-6);
        const start = center.dot(startNormal);
        const at = Math.min(high - span * 0.01, Math.max(low + span * 0.01, start + along - gizmoDrag.startAlong));
        cutEditor.setPlane(startNormal, center.clone().addScaledVector(startNormal, at - start));
        info.onCutReadout?.(`Cut ${Math.round(((at - low) / span) * 100)}% of the way up`);
        return;
      }
      const angle = screenAngle(event, center);
      let step = angle - gizmoDrag.lastAngle;
      if (step > Math.PI) step -= Math.PI * 2;
      if (step < -Math.PI) step += Math.PI * 2;
      gizmoDrag.turned += step;
      gizmoDrag.lastAngle = angle;
      const axis = CUT_AXES[handle];
      // Counterclockwise on screen turns the right-hand way about an axis facing the camera.
      const toCamera = camera.position.clone().sub(modelRoot.localToWorld(center.clone()));
      const sign = axis.clone().transformDirection(modelRoot.matrixWorld).dot(toCamera) >= 0 ? 1 : -1;
      const snap = event.ctrlKey ? 15 : 1;
      const degrees = Math.round((sign * gizmoDrag.turned * 180) / Math.PI / snap) * snap;
      const normal = startNormal.clone().applyAxisAngle(axis, (degrees * Math.PI) / 180);
      cutEditor.setPlane(normal, center);
      const { tilt, turn } = normalAngles(normal);
      info.onCutReadout?.(`${handle.toUpperCase()} ${degrees > 0 ? "+" : ""}${degrees}° · Tilt ${tilt}° · Turn ${turn}°`);
    };
    const finishGizmo = () => {
      gizmoDrag.active = false;
      editing.dragging = false;
      cutEditor.setActive(null);
      controls.enabled = true;
      renderer.domElement.style.cursor = "";
      const info = dragRef.current;
      info.onCutReadout?.(null);
      const { tilt, turn } = normalAngles(cutEditor.normal);
      const normal = cutNormal(tilt, turn);
      const [low, high] = cutEditor.extent(normal);
      const share = Math.min(0.99, Math.max(0.01, (cutEditor.point.dot(normal) - low) / Math.max(high - low, 1e-6)));
      cutEditor.setPlane(normal, cutEditor.point);
      if (tilt === info.cutTilt && turn === info.cutTurn && Math.abs(share - (info.cutShare ?? 0)) < 0.002) {
        info.syncCut?.();
        return;
      }
      cutEditor.markStale();
      info.onCutTransform?.(tilt, turn, share);
    };
    // Hovering outlines the smart-fill region under the pointer; with Ctrl it lights the piece
    // over the cut instead.
    let notice = false;
    const hover = (event: PointerEvent) => {
      if (event.target !== renderer.domElement) {
        cutEditor.setHover(null, -1);
        cutEditor.setRegionHover(-1);
        return;
      }
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const handle = cutEditor.pickHandle(raycaster);
      const piece = !handle && event.ctrlKey ? cutEditor.pickPiece(raycaster) : -1;
      const region = !handle && !event.ctrlKey ? cutEditor.pickRegion(raycaster) : -1;
      cutEditor.setHover(handle, piece);
      cutEditor.setRegionHover(region);
      if (fillNoteRef.current && region >= 0) {
        const used = cutEditor.usedFillAngle;
        fillNoteRef.current.textContent = used < fillAngleRef.current ? `Smooth model: using ${used}°` : "";
      }
      if (notice && region < 0) {
        notice = false;
        dragRef.current.onCutReadout?.(null);
      }
      renderer.domElement.style.cursor = handle ? "grab" : piece >= 0 || region >= 0 ? "pointer" : "";
    };
    const pickRegion = (event: PointerEvent) => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const info = dragRef.current;
      const region = cutEditor.pickRegion(raycaster);
      if (region < 0 || !info.onCutPick) return;
      const suggestion = cutEditor.suggestCut(region);
      if (!suggestion) {
        notice = true;
        info.onCutReadout?.("That part is most of the model. Lower the smart fill angle to split it at its edges.");
        return;
      }
      const normal = new THREE.Vector3(...suggestion.normal);
      const [low, high] = cutEditor.extent(normal);
      const share = Math.min(0.99, Math.max(0.01, (suggestion.offset - low) / Math.max(high - low, 1e-6)));
      const unit = cutEditor.unit;
      cutEditor.setPlane(normal, normal.clone().multiplyScalar(suggestion.offset));
      cutEditor.markStale();
      info.onCutPick(suggestion.tilt, suggestion.turn, share, {
        x: suggestion.at[0] / unit,
        y: suggestion.at[1] / unit,
        z: suggestion.at[2] / unit,
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (editing.on && !fit.assembly) {
        onEditorDown(event);
        return;
      }
      if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const info = dragRef.current;
      if (fit.assembly) return;
      if (!info.onCharmMove && !info.onHoleMove && !info.onCutMove) return;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([textMesh, baseMesh], false)[0];
      if (!hit) return;
      const local = modelRoot.worldToLocal(hit.point.clone());
      let target: "charm" | "hole" | "cut" | null = null;
      const hole = info.hole;
      if (hole && info.onHoleMove) {
        const reach = hole.radius + 1.8;
        const away = unturn(hole.basis, new THREE.Vector3(local.x - hole.x, local.y - hole.y, local.z - (hole.z ?? 0)));
        const offset = !hole.axis ? away.x ** 2 + away.y ** 2 : (hole.axis === "x" ? away.y : away.x) ** 2 + away.z ** 2;
        if (offset <= reach ** 2) target = "hole";
      }
      const cut = info.cut;
      if (
        !target &&
        cut &&
        info.onCutMove &&
        local.z >= cut.z - 4 &&
        local.z <= cut.z + 1 &&
        local.x >= cut.minX - 1 &&
        local.x <= cut.maxX + 1
      ) {
        target = "cut";
      }
      let charmIndex = -1;
      if (!target && info.onCharmMove) {
        const pad = 1.6;
        for (let index = info.charmBounds.length - 1; index >= 0; index -= 1) {
          const box = info.charmBounds[index];
          if (
            local.x >= box.minX - pad &&
            local.x <= box.maxX + pad &&
            local.y >= box.minY - pad &&
            local.y <= box.maxY + pad
          ) {
            charmIndex = index;
            target = "charm";
            break;
          }
        }
      }
      if (!target) return;
      drag.active = true;
      drag.target = target;
      drag.charmIndex = charmIndex;
      drag.pointerId = event.pointerId;
      drag.startLocal.copy(local);
      const charm = info.charms[charmIndex];
      drag.startX = target === "hole" ? info.holeX : target === "cut" ? (cut?.mm ?? 0) : (charm?.x ?? 0);
      drag.startY = target === "hole" ? info.holeY : (charm?.y ?? 0);
      const axis = target === "hole" ? hole?.axis : undefined;
      const normal = returnTurn(
        axis ? hole?.basis : undefined,
        new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis ? 0 : 1),
      ).transformDirection(modelRoot.matrixWorld);
      if (target === "cut") {
        // The cut moves up and down, on an upright plane facing the camera.
        const facing = camera
          .getWorldDirection(new THREE.Vector3())
          .transformDirection(modelRoot.matrixWorld.clone().invert());
        facing.z = 0;
        if (facing.lengthSq() < 1e-6) facing.set(0, 1, 0);
        normal.copy(facing.normalize()).transformDirection(modelRoot.matrixWorld);
      }
      drag.plane.setFromNormalAndCoplanarPoint(normal, hit.point);
      userMoved = true;
      controls.enabled = false;
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (gizmoDrag.active) {
        if (event.pointerId === gizmoDrag.pointerId) onGizmoMove(event);
        return;
      }
      if (editing.on && !drag.active) {
        // Picked once a frame; orbiting with a button held doesn't hover.
        hoverEvent = event.buttons === 0 ? event : null;
        return;
      }
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(drag.plane, drag.hit)) return;
      const local = modelRoot.worldToLocal(drag.hit.clone());
      const info = dragRef.current;
      const dx = local.x - drag.startLocal.x;
      const dy = local.y - drag.startLocal.y;
      if (drag.target === "cut") {
        info.onCutMove?.(drag.startX + local.z - drag.startLocal.z);
        return;
      }
      const hole = info.hole;
      if (drag.target === "hole" && hole?.axis && hole.unit) {
        const moved = unturn(hole.basis, new THREE.Vector3(dx, dy, local.z - drag.startLocal.z));
        const across = hole.axis === "x" ? moved.y : moved.x;
        info.onHoleMove?.(drag.startX + across / hole.unit, drag.startY + moved.z / hole.unit);
        return;
      }
      if (drag.target === "hole") {
        info.onHoleMove?.(
          Math.min(120, Math.max(-120, drag.startX + dx)),
          Math.min(80, Math.max(-80, drag.startY + dy)),
        );
        return;
      }
      info.onCharmMove?.(
        drag.charmIndex,
        Math.min(LIMITS.charmOffsetX[1], Math.max(LIMITS.charmOffsetX[0], drag.startX + dx)),
        Math.min(LIMITS.charmOffsetY[1], Math.max(LIMITS.charmOffsetY[0], drag.startY + dy)),
      );
    };

    const endDrag = (event: PointerEvent) => {
      if (gizmoDrag.active && event.pointerId === gizmoDrag.pointerId) {
        finishGizmo();
        return;
      }
      if (click.pointerId === event.pointerId) {
        click.pointerId = -1;
        if (event.type === "pointerup" && editing.on && Math.hypot(event.clientX - click.x, event.clientY - click.y) < 5) {
          if (event.ctrlKey) {
            setPointer(event);
            raycaster.setFromCamera(pointer, camera);
            const piece = cutEditor.pickPiece(raycaster);
            if (piece >= 0) dragRef.current.onCutPiece?.(piece);
          } else pickRegion(event);
        }
      }
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      drag.active = false;
      controls.enabled = true;
      renderer.domElement.style.cursor = "";
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controls.removeEventListener("start", onStart);
      renderer.domElement.removeEventListener("mousedown", blockMiddleClick);
      renderer.domElement.removeEventListener("auxclick", blockMiddleClick);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      textMat.dispose();
      baseMat.dispose();
      cutEditor.dispose();
      clearDimensions(dimensionGroup);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    clearDimensions(api.dimensionGroup);
    if (!model) {
      api.textMesh.visible = false;
      api.baseMesh.visible = false;
      return;
    }
    api.textMesh.geometry = model.text;
    api.baseMesh.geometry = model.base;
    api.textMesh.visible = true;
    api.baseMesh.visible = true;
    if (model.assembly) {
      api.housingText.geometry = model.assembly.housing.text;
      api.housingBase.geometry = model.assembly.housing.base;
      api.capText.geometry = model.assembly.cap.text;
      api.capBase.geometry = model.assembly.cap.base;
    }
    if (showDimensions) addDimensions(api.dimensionGroup, model);
    api.frame(false);
  }, [model, showDimensions]);

  // Playing swaps in the parts apart and moves the cap onto the housing; pausing puts
  // both back on the bed.
  const assembly = model?.assembly ?? null;
  const animating = playing && assembly !== null && !editing;
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const wasAnimating = api.fit.assembly !== null;
    api.fit.assembly = animating ? assembly : null;
    if (animating && !wasAnimating) api.fit.start = performance.now() / 1000;
    if (!animating) api.capGroup.position.set(0, 0, 0);
    api.fitGroup.visible = animating;
    api.textMesh.visible = !animating && !editing && model !== null;
    api.baseMesh.visible = !animating && !editing && model !== null;
  }, [animating, assembly, model, editing]);

  // The cut editor swaps the parts for the uncut model with the cut through it.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.editing.on = editing;
    api.cutEditor.group.visible = editing;
    if (!editing) api.cutEditor.setHover(null, -1);
    api.frame(true);
  }, [editing]);

  const lineColorKey = (lineColors ?? []).join(",");
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.textMat.color.set(textColor);
    api.baseMat.color.set(baseColor);
    const extra = lineMatsRef.current;
    if (!model || !hasLineColors(model.text)) {
      api.textMesh.material = api.textMat;
      return;
    }
    const colors = textSlotColors(model.text, textColor, lineColorKey ? lineColorKey.split(",") : []);
    api.textMat.color.set(colors[0]);
    while (extra.length < colors.length - 1) extra.push(api.textMat.clone());
    colors.slice(1).forEach((color, index) => extra[index].color.set(color));
    api.textMesh.material = [api.textMat, ...extra.slice(0, colors.length - 1)];
  }, [model, textColor, baseColor, lineColorKey]);

  useEffect(() => {
    const extra = lineMatsRef.current;
    return () => {
      for (const material of extra) material.dispose();
    };
  }, []);

  return (
    <>
      <div
        ref={hostRef}
        className="absolute inset-0"
        role="img"
        aria-label="Interactive 3D preview. Drag to orbit, Shift and drag to pan, scroll to zoom. Drag an icon or the keyring hole to move that part on its own."
      />
      <div className="absolute top-3 right-3 z-10 flex flex-wrap items-center justify-end gap-2">
        {canEditCut ? (
          <button
            type="button"
            aria-pressed={editing}
            title={editing ? "Done: back to the parts" : "Turn and move the cut on the whole model, and pick which pieces click"}
            onClick={() => setEditingCut((current) => !current)}
            className={`${TOOL} ${editing ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "bg-white/90 text-zinc-600 hover:bg-white"}`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" />
              <path d="M1.5 9.5 14.5 6.5" strokeLinecap="round" />
            </svg>
            {editing ? "Done" : "Edit cut"}
          </button>
        ) : null}
        {assembly && !editing ? (
          <button
            type="button"
            aria-pressed={animating}
            aria-label={animating ? "Pause the fit animation" : "Play the fit animation"}
            title={animating ? "Pause: back on the bed" : "Play: put the cap on the housing and click it"}
            onClick={() => setPlaying((current) => !current)}
            className={`${TOOL} bg-white/90 text-zinc-600 hover:bg-white`}
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden="true">
              {animating ? <path d="M2 1.5h3v9H2zM7 1.5h3v9H7z" /> : <path d="M2.5 1.2v9.6L10.5 6z" />}
            </svg>
            {animating ? "Pause" : "Play"}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={showDimensions}
          onClick={onToggleDimensions}
          className={`${TOOL} bg-white/90 text-zinc-600 hover:bg-white`}
        >
          Dimensions {showDimensions ? "On" : "Off"}
        </button>
        <button type="button" onClick={() => apiRef.current?.frame(true)} className={`${TOOL} bg-white/90 text-zinc-600 hover:bg-white`}>
          Reset view
        </button>
      </div>
      {editing ? (
        <div className="absolute top-14 right-3 z-10 max-w-[17rem] rounded-xl bg-white/90 px-3 py-2 text-xs text-zinc-600 shadow-sm backdrop-blur">
          {cutReadout ? (
            <p className="font-medium tabular-nums text-zinc-800">{cutReadout}</p>
          ) : (
            <>
              <p>
                Hover the model: a <span className="font-medium text-zinc-900">white outline</span> shows a part found by its edges.
                Click it to cut that part off as the <span className="font-medium text-blue-500">cap</span>.
              </p>
              <p className="mt-1">
                Drag a <span className="font-medium text-red-500">red</span>, <span className="font-medium text-green-600">green</span>,
                or <span className="font-medium text-blue-600">blue</span> ring to turn the cut, and the{" "}
                <span className="font-medium text-amber-500">arrow</span> to slide it. Hold Ctrl to snap to 15°.
              </p>
              <p className="mt-1">Ctrl+click a piece over the cut to swap it between cap and housing.</p>
            </>
          )}
          <label className="mt-2 flex items-center gap-2 border-t border-[#f0f1f4] pt-2">
            <span className="shrink-0">Smart fill angle</span>
            <input
              aria-label="Smart fill angle"
              type="range"
              min={5}
              max={90}
              step={1}
              value={fillAngle}
              onChange={(event) => setFillAngle(Number(event.target.value))}
              className="min-w-0 flex-1 accent-blue-600"
            />
            <span className="w-7 text-right tabular-nums">{fillAngle}°</span>
          </label>
          <span ref={fillNoteRef} className="block text-[11px] text-zinc-400 empty:hidden" />
        </div>
      ) : null}
    </>
  );
}

function clearDimensions(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (object instanceof THREE.Line) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      } else if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
  }
}

function addDimensions(group: THREE.Group, model: KeychainModel) {
  const bounds = new THREE.Box3().setFromBufferAttribute(
    model.base.getAttribute("position") as THREE.BufferAttribute,
  ).union(
    new THREE.Box3().setFromBufferAttribute(model.text.getAttribute("position") as THREE.BufferAttribute),
  );
  const min = bounds.min;
  const max = bounds.max;
  const offset = Math.max(3, Math.max(model.width, model.height) * 0.08);
  const z = max.z + 0.6;
  const annotations = [
    {
      points: [
        new THREE.Vector3(min.x, min.y - offset, z),
        new THREE.Vector3(max.x, min.y - offset, z),
      ],
      label: `${model.width.toFixed(1)} mm`,
      labelAt: new THREE.Vector3((min.x + max.x) / 2, min.y - offset, z),
    },
    {
      points: [
        new THREE.Vector3(max.x + offset, min.y, z),
        new THREE.Vector3(max.x + offset, max.y, z),
      ],
      label: `${model.height.toFixed(1)} mm`,
      labelAt: new THREE.Vector3(max.x + offset, (min.y + max.y) / 2, z),
    },
    {
      points: [
        new THREE.Vector3(min.x - offset * 0.65, max.y + offset * 0.4, min.z),
        new THREE.Vector3(min.x - offset * 0.65, max.y + offset * 0.4, max.z),
      ],
      label: `${model.depth.toFixed(1)} mm`,
      labelAt: new THREE.Vector3(min.x - offset * 0.65, max.y + offset * 0.4, (min.z + max.z) / 2),
    },
  ];

  for (const annotation of annotations) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(annotation.points),
      new THREE.LineBasicMaterial({ color: "#2563eb", depthTest: false }),
    );
    line.renderOrder = 10;
    group.add(line, dimensionLabel(annotation.label, annotation.labelAt, model));
  }
}

function dimensionLabel(label: string, position: THREE.Vector3, model: KeychainModel) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create dimension labels.");
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.strokeStyle = "#bfdbfe";
  context.lineWidth = 5;
  context.beginPath();
  context.roundRect(4, 4, 312, 88, 18);
  context.fill();
  context.stroke();
  context.fillStyle = "#1e3a8a";
  context.font = "bold 38px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 160, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  const height = Math.max(3.4, Math.max(model.width, model.height) * 0.075);
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  sprite.position.copy(position);
  sprite.renderOrder = 11;
  return sprite;
}
