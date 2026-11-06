"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type PreviewPart = { positions: Float32Array; color: string };

export type PreviewHandle = {
  // The current view drawn at `width` x `height` CSS pixels on a transparent background.
  snapshot: (width: number, height: number) => HTMLCanvasElement | null;
};

type Scene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dimensions: THREE.Group;
  box: THREE.Box3;
  center: THREE.Vector3;
  resize: () => void;
};

// A small turntable view of loose triangles (Z up), framed to fit, with `children` laid over
// it. `mmPerUnit` sizes the dimension labels in real millimeters.
export function ModelPreview({
  parts,
  mmPerUnit = 1,
  ref,
  children,
}: {
  parts: PreviewPart[];
  mmPerUnit?: number;
  ref?: Ref<PreviewHandle>;
  children?: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [showDimensions, setShowDimensions] = useState(false);

  useImperativeHandle(ref, () => ({
    snapshot(width, height) {
      const current = sceneRef.current;
      if (!current) return null;
      const { renderer, scene, camera, center, resize } = current;
      const ratio = 2;
      // The picture is wider than the preview, so the model can fill more of it.
      const position = camera.position.clone();
      camera.position.lerp(center, 0.22);
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const canvas = document.createElement("canvas");
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.getContext("2d")?.drawImage(renderer.domElement, 0, 0);
      camera.position.copy(position);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      resize();
      return canvas;
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.className = "block h-full w-full cursor-grab active:cursor-grabbing";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a46, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfd8ff, 0.8);
    rim.position.set(-1.5, 0.5, -1);
    scene.add(rim);

    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    scene.add(root);
    const disposables: { dispose: () => void }[] = [];
    const box = new THREE.Box3();
    for (const part of parts) {
      if (!part.positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox!);
      const material = new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.5, side: THREE.DoubleSide });
      root.add(new THREE.Mesh(geometry, material));
      disposables.push(geometry, material);
    }
    const dimensions = new THREE.Group();
    root.add(dimensions);
    root.updateMatrixWorld(true);
    const shown = box.clone().applyMatrix4(root.matrixWorld);
    const center = shown.getCenter(new THREE.Vector3());
    const radius = Math.max(shown.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);

    const camera = new THREE.PerspectiveCamera(32, 1, radius / 100, radius * 100);
    // Room around the model for the dimension lines.
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(16))) * 1.3;
    camera.position.copy(center).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(distance));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.enablePan = false;
    // The dialog scrolls with the wheel, so the preview doesn't zoom.
    controls.enableZoom = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    sceneRef.current = { renderer, scene, camera, dimensions, box, center: controls.target, resize };

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      clearDimensions(dimensions);
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [parts]);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    clearDimensions(current.dimensions);
    if (showDimensions && !current.box.isEmpty()) addDimensions(current.dimensions, current.box, mmPerUnit);
  }, [parts, mmPerUnit, showDimensions]);

  return (
    <div className="relative h-56 overflow-hidden rounded-lg bg-gradient-to-b from-[#2a2a33] to-[#18181d] sm:h-64">
      <div ref={hostRef} className="absolute inset-0" />
      {children}
      <button
        type="button"
        aria-pressed={showDimensions}
        onClick={() => setShowDimensions((on) => !on)}
        className="absolute bottom-2 left-2 h-7 rounded-md bg-white/10 px-2.5 text-[11px] font-medium text-zinc-200 hover:bg-white/20"
      >
        Dimensions {showDimensions ? "On" : "Off"}
      </button>
    </div>
  );
}

function clearDimensions(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Line) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    } else if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  }
}

// Width, depth and height lines around `box` (model units, Z up), labeled in millimeters.
function addDimensions(group: THREE.Group, box: THREE.Box3, mmPerUnit: number) {
  const { min, max } = box;
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const offset = longest * 0.1;
  const tick = longest * 0.03;
  const label = (length: number) => `${(length * mmPerUnit).toFixed(1)} mm`;
  const annotations = [
    {
      from: new THREE.Vector3(min.x, min.y - offset, min.z),
      to: new THREE.Vector3(max.x, min.y - offset, min.z),
      across: new THREE.Vector3(0, tick, 0),
      text: label(size.x),
    },
    {
      from: new THREE.Vector3(max.x + offset, min.y, min.z),
      to: new THREE.Vector3(max.x + offset, max.y, min.z),
      across: new THREE.Vector3(tick, 0, 0),
      text: label(size.y),
    },
    {
      from: new THREE.Vector3(min.x - offset, max.y + offset * 0.5, min.z),
      to: new THREE.Vector3(min.x - offset, max.y + offset * 0.5, max.z),
      across: new THREE.Vector3(tick, 0, 0),
      text: label(size.z),
    },
  ];
  for (const { from, to, across, text } of annotations) {
    const points = [
      from.clone().add(across),
      from.clone().sub(across),
      from,
      to,
      to.clone().add(across),
      to.clone().sub(across),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: "#60a5fa", depthTest: false }),
    );
    line.renderOrder = 10;
    group.add(line, dimensionLabel(text, from.clone().lerp(to, 0.5)));
  }
}

function dimensionLabel(text: string, position: THREE.Vector3) {
  const canvas = document.createElement("canvas");
  canvas.width = 280;
  canvas.height = 84;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create dimension labels.");
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.strokeStyle = "#bfdbfe";
  context.lineWidth = 5;
  context.beginPath();
  context.roundRect(4, 4, 272, 76, 18);
  context.fill();
  context.stroke();
  context.fillStyle = "#1e3a8a";
  context.font = "bold 44px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 140, 44, 248);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // A fixed size on screen, so it stays readable however big the model is.
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, sizeAttenuation: false }),
  );
  const height = 0.045;
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  sprite.position.copy(position);
  sprite.renderOrder = 11;
  return sprite;
}
