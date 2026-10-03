"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { KeychainModel } from "@/lib/geometry";

type ViewerApi = {
  textMesh: THREE.Mesh;
  baseMesh: THREE.Mesh;
  textMat: THREE.MeshStandardMaterial;
  baseMat: THREE.MeshStandardMaterial;
  frame: (reset: boolean) => void;
};

type ViewerProps = {
  model: KeychainModel | null;
  textColor: string;
  baseColor: string;
};

export function Viewer({ model, textColor, baseColor }: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);
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
    textMesh.castShadow = true;
    baseMesh.castShadow = true;
    textMesh.visible = false;
    baseMesh.visible = false;
    modelRoot.add(baseMesh, textMesh);

    let userMoved = false;
    const framedCenter = new THREE.Vector3();
    const onStart = () => {
      userMoved = true;
    };
    controls.addEventListener("start", onStart);

    const frame = (reset: boolean) => {
      if (reset) userMoved = false;
      modelRoot.rotation.order = "XZY";
      modelRoot.rotation.set(-Math.PI / 2, 0, 0.52);
      modelRoot.position.set(0, 0, 0);
      modelRoot.updateWorldMatrix(true, true);
      const raw = new THREE.Box3().setFromObject(modelRoot);
      if (raw.isEmpty()) return;
      modelRoot.position.y -= raw.min.y;
      modelRoot.updateWorldMatrix(true, true);
      const placed = new THREE.Box3().setFromObject(modelRoot);
      const center = placed.getCenter(new THREE.Vector3());
      const size = placed.getSize(new THREE.Vector3());
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
      frame(false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    const onVisibility = () => {
      renderer.setAnimationLoop(document.hidden ? null : loop);
    };
    document.addEventListener("visibilitychange", onVisibility);
    renderer.setAnimationLoop(loop);

    apiRef.current = { textMesh, baseMesh, textMat, baseMat, frame };

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controls.removeEventListener("start", onStart);
      renderer.domElement.removeEventListener("mousedown", blockMiddleClick);
      renderer.domElement.removeEventListener("auxclick", blockMiddleClick);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      textMat.dispose();
      baseMat.dispose();
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
    if (!model) {
      api.textMesh.visible = false;
      api.baseMesh.visible = false;
      return;
    }
    api.textMesh.geometry = model.text;
    api.baseMesh.geometry = model.base;
    api.textMesh.visible = true;
    api.baseMesh.visible = true;
    api.frame(false);
  }, [model]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.textMat.color.set(textColor);
    api.baseMat.color.set(baseColor);
  }, [textColor, baseColor]);

  return (
    <>
      <div
        ref={hostRef}
        className="absolute inset-0"
        role="img"
        aria-label="Interactive 3D preview. Drag to orbit, Shift and drag to pan, scroll to zoom."
      />
      <button
        type="button"
        onClick={() => apiRef.current?.frame(true)}
        className="absolute top-3 right-3 z-10 rounded-full border border-[#e6e7ec] bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur hover:bg-white"
      >
        Reset view
      </button>
    </>
  );
}
