import { strToU8, zipSync } from "fflate";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { KeychainModel } from "./geometry";

export type ExportFormat = "3mf" | "stl" | "obj" | "glb";

export const EXPORT_FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "3mf", label: "3MF", hint: "Best for color printing" },
  { id: "stl", label: "STL", hint: "Universal slicer file" },
  { id: "obj", label: "OBJ", hint: "Text and base as two objects" },
  { id: "glb", label: "GLB", hint: "Color model for 3D viewers" },
];

export async function exportKeychain(
  model: KeychainModel,
  format: ExportFormat,
  textColor: string,
  baseColor: string,
  name: string,
) {
  const group = new THREE.Group();
  group.add(meshFrom(model.base, "Base", baseColor));
  group.add(meshFrom(model.text, "Text", textColor));

  try {
    if (format === "stl") {
      const exporter = new STLExporter();
      const data = exporter.parse(group, { binary: true }) as DataView;
      const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      return {
        blob: new Blob([bytes], { type: "model/stl" }),
        filename: `${name}-keychain.stl`,
      };
    }

    if (format === "obj") {
      const exporter = new OBJExporter();
      const obj = exporter.parse(group);
      return {
        blob: new Blob([obj], { type: "model/obj" }),
        filename: `${name}-keychain.obj`,
      };
    }

    if (format === "glb") {
      const exportGroup = group.clone(true);
      exportGroup.scale.setScalar(0.001);
      exportGroup.rotation.x = -Math.PI / 2;
      const exporter = new GLTFExporter();
      const glb = await exporter.parseAsync(exportGroup, { binary: true });
      return {
        blob: new Blob([glb as ArrayBuffer], { type: "model/gltf-binary" }),
        filename: `${name}-keychain.glb`,
      };
    }

    return {
      blob: new Blob([build3mf(model, textColor, baseColor, name)], { type: "model/3mf" }),
      filename: `${name}-keychain.3mf`,
    };
  } finally {
    disposeMaterials(group);
  }
}

export function slugify(text: string) {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "keychain";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function disposeMaterials(group: THREE.Group) {
  const seen = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      material.dispose();
    }
  });
}

function meshFrom(geometry: THREE.BufferGeometry, name: string, color: string) {
  const material = new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: 0.5,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function build3mf(model: KeychainModel, textColor: string, baseColor: string, name: string) {
  const textHex = colorHex(textColor);
  const baseHex = colorHex(baseColor);
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m">
  <metadata name="Application">Keychain Generator</metadata>
  <metadata name="Title">${escapeXml(name)} keychain</metadata>
  <resources>
    <m:colorgroup id="1">
      <m:color color="${textHex}"/>
    </m:colorgroup>
    <m:colorgroup id="2">
      <m:color color="${baseHex}"/>
    </m:colorgroup>
    ${objectXml(3, "Text", model.text, 1, 0, "4")}
    ${objectXml(4, "Base", model.base, 2, 1, "8")}
  </resources>
  <build>
    <item objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
    <item objectid="4" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
  </build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(modelXml),
  });
}

function objectXml(
  id: number,
  name: string,
  geometry: THREE.BufferGeometry,
  colorGroupId: number,
  colorIndex: number,
  paintColor: string,
) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const vertices: string[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    vertices.push(
      `<vertex x="${position.getX(vertex).toFixed(4)}" y="${position.getY(vertex).toFixed(4)}" z="${position.getZ(vertex).toFixed(4)}"/>`,
    );
  }
  const triangles: string[] = [];
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = index ? index.getX(triangle * 3) : triangle * 3;
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    triangles.push(
      `<triangle v1="${a}" v2="${b}" v3="${c}" pid="${colorGroupId}" p1="${colorIndex}" p2="${colorIndex}" p3="${colorIndex}" paint_color="${paintColor}"/>`,
    );
  }
  return `<object id="${id}" type="model" name="${escapeXml(name)}" pid="${colorGroupId}" pindex="${colorIndex}">
      <mesh>
        <vertices>${vertices.join("")}</vertices>
        <triangles>${triangles.join("")}</triangles>
      </mesh>
    </object>`;
}

function colorHex(color: string) {
  const body = color.trim().replace("#", "");
  const rgb = body.length >= 6 ? body.slice(0, 6) : "888888";
  return `#${rgb}FF`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&apos;";
  });
}
