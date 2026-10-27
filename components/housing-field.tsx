"use client";

import { useMemo, useRef, useState } from "react";
import type { ProductSettings } from "@/lib/catalog";
import {
  bounds,
  clickerKeyCount,
  clickerLayout,
  clickerLayoutInput,
  HOUSING_SHAPES,
  partsLayout,
  partsMode,
  type Pt,
} from "@/lib/clicker-layout";
import { imageParts, mainColor, type ImagePart } from "@/lib/image-parts";
import { importImageParts } from "@/lib/logo";

type Props = {
  slug: string;
  label: string;
  settings: ProductSettings;
  patch: (partial: Partial<ProductSettings>) => void;
  onError: (message: string | null) => void;
};

const MARGIN = 8;

export function HousingField({ slug, label, settings, patch, onError }: Props) {
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState<{ index: number; offset: Pt; positions: Pt[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  const parts = settings.housingShape === "custom" ? imageParts(settings.housingLogo) : null;
  const picking = partsMode(settings);
  const keys = clickerKeyCount(settings);
  const labels = useMemo(() => {
    const chars = Array.from(settings.text.normalize("NFC")).filter((char) => char.trim());
    return Array.from({ length: keys }, (_, index) => chars[index] ?? "★");
  }, [settings.text, keys]);

  const layout = useMemo(() => {
    if (!keys || picking) return null;
    try {
      const input = clickerLayoutInput(settings, keys);
      return clickerLayout(dragging ? { ...input, positions: dragging.positions } : input);
    } catch {
      return null;
    }
  }, [settings, keys, dragging, picking]);

  async function onUpload(file: File) {
    setImporting(true);
    try {
      const id = await importImageParts(file);
      const parts = imageParts(id) ?? [];
      patch({ housingShape: "custom", housingLogo: id, keyLayout: [], housingParts: [], baseColor: mainColor(parts) });
      onError(null);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not convert that shape.");
    } finally {
      setImporting(false);
    }
  }

  function toModel(event: React.PointerEvent): Pt | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: -point.y };
  }

  const capBox = layout ? bounds(layout.cap) : null;
  const capSpan = capBox ? Math.max(capBox.maxX - capBox.minX, capBox.maxY - capBox.minY) : 0;
  const box = layout
    ? layout.outline.length
      ? bounds(layout.outline)
      : bounds(layout.positions.flatMap(({ x, y }) => [{ x: x - capSpan, y: y - capSpan }, { x: x + capSpan, y: y + capSpan }]))
    : null;
  const viewBox = box
    ? `${box.minX - MARGIN} ${-box.maxY - MARGIN} ${box.maxX - box.minX + MARGIN * 2} ${box.maxY - box.minY + MARGIN * 2}`
    : "0 0 1 1";
  const path = (ring: Pt[], dx = 0, dy = 0) =>
    `M${ring.map((point) => `${(point.x + dx).toFixed(2)},${(-(point.y + dy)).toFixed(2)}`).join("L")}Z`;

  return (
    <div className="mb-3 text-sm text-zinc-600">
      <label htmlFor={`${slug}-housing-shape`}>{label}</label>
      <div className="mt-1 flex gap-2">
        <select
          id={`${slug}-housing-shape`}
          value={settings.housingShape}
          onChange={(event) => {
            const housingShape = event.target.value as ProductSettings["housingShape"];
            if (housingShape === "custom" && !settings.housingLogo) {
              fileInput.current?.click();
              return;
            }
            patch({ housingShape, keyLayout: [] });
          }}
          className="h-10 min-w-0 flex-1 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
        >
          {HOUSING_SHAPES.map((shape) => (
            <option key={shape.value} value={shape.value}>
              {shape.label}
            </option>
          ))}
        </select>
        {settings.housingShape !== "rect" && !picking && (
          <select
            aria-label="Keycap shape"
            value={settings.capShape}
            onChange={(event) => patch({ capShape: event.target.value as ProductSettings["capShape"], keyLayout: [] })}
            className="h-10 w-36 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
          >
            <option value="match">Caps match housing</option>
            <option value="square">Square caps</option>
          </select>
        )}
      </div>
      <input
        ref={fileInput}
        id={`${slug}-housing-file`}
        type="file"
        accept=".svg,.png,image/svg+xml,image/png"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onUpload(file);
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label
          htmlFor={`${slug}-housing-file`}
          className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#e6e7ec] bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          {importing ? "Converting…" : "Upload shape (SVG or PNG)"}
        </label>
        {!["rect", "pill"].includes(settings.housingShape) && !picking && (
          <label className="flex items-center gap-2">
            <span>Size</span>
            <input
              aria-label="Housing size"
              type="number"
              min={0}
              max={600}
              step={1}
              placeholder="Auto"
              value={settings.housingSize || ""}
              onChange={(event) => patch({ housingSize: Math.max(0, Math.min(600, Number(event.target.value) || 0)) })}
              className="h-9 w-20 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
            />
            <span className="text-xs text-zinc-400">mm</span>
          </label>
        )}
      </div>
      {parts ? <PartsPicker parts={parts} settings={settings} patch={patch} /> : null}
      {layout && box && !picking ? (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span>Key placement</span>
            <button
              type="button"
              disabled={!settings.keyLayout.length}
              onClick={() => patch({ keyLayout: [] })}
              className="h-8 rounded-lg border border-[#e6e7ec] bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              Auto arrange
            </button>
          </div>
          <svg
            ref={svg}
            viewBox={viewBox}
            className="mt-1 h-44 w-full touch-none select-none rounded-lg border border-[#e6e7ec] bg-[#fafafa]"
            onPointerMove={(event) => {
              if (!dragging) return;
              const point = toModel(event);
              if (!point) return;
              const positions = dragging.positions.map((position, index) =>
                index === dragging.index
                  ? {
                      x: Math.round((point.x - dragging.offset.x) * 2) / 2,
                      y: Math.round((point.y - dragging.offset.y) * 2) / 2,
                    }
                  : position,
              );
              setDragging({ ...dragging, positions });
            }}
            onPointerUp={() => {
              if (!dragging) return;
              patch({ keyLayout: dragging.positions });
              setDragging(null);
            }}
            onPointerCancel={() => setDragging(null)}
          >
            {layout.outline.length ? (
              <path d={path(layout.outline)} fill="#e4e4e7" stroke="#a1a1aa" strokeWidth={0.4} />
            ) : null}
            {layout.positions.map((position, index) => (
              <g
                key={index}
                role="button"
                aria-label={`Move key ${labels[index]}`}
                className="cursor-grab"
                onPointerDown={(event) => {
                  const point = toModel(event);
                  if (!point) return;
                  svg.current?.setPointerCapture(event.pointerId);
                  setDragging({
                    index,
                    offset: { x: point.x - position.x, y: point.y - position.y },
                    positions: layout.positions,
                  });
                }}
              >
                <path
                  d={path(layout.cap, position.x, position.y)}
                  fill={dragging?.index === index ? "#c7d2fe" : "#ffffff"}
                  stroke={layout.error ? "#ef4444" : "#71717a"}
                  strokeWidth={0.5}
                />
                <text
                  x={position.x}
                  y={-position.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={8}
                  fill="#3f3f46"
                >
                  {labels[index]}
                </text>
              </g>
            ))}
          </svg>
          <span className={`mt-1 block text-xs ${layout.error ? "text-red-500" : "text-zinc-400"}`}>
            {layout.error ??
              `Housing ${(box.maxX - box.minX).toFixed(0)} × ${(box.maxY - box.minY).toFixed(0)} mm. Drag a key to place its switch where you want it; the housing grows to fit.`}
          </span>
          {settings.capShape === "match" && capSpan > 30 && (
            <span className="mt-1 block text-xs text-amber-600">
              Each cap has to cover a whole switch, so a thin shape makes {capSpan.toFixed(0)} mm caps. Pick Square caps for a smaller clicker.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// The imported picture, one shape per color region. Hovering outlines the region a click
// would turn into a clicker key; Shift+click joins a region to the last key.
function PartsPicker({
  parts,
  settings,
  patch,
}: {
  parts: ImagePart[];
  settings: ProductSettings;
  patch: (partial: Partial<ProductSettings>) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const groups = settings.housingParts;
  const caps = settings.partCaps ?? "whole";
  const whole = caps === "whole";
  const layout = useMemo(
    () => (whole || groups.length ? partsLayout(settings.housingLogo, groups, settings.housingSize, caps) : null),
    [settings.housingLogo, groups, settings.housingSize, caps, whole],
  );
  // The smallest housing that still fits every clicker; the size can't go below it.
  const smallest = useMemo(() => {
    const fitted = whole || groups.length ? partsLayout(settings.housingLogo, groups, 0, caps) : null;
    if (!fitted || fitted.error) return null;
    const box = bounds(fitted.outline);
    return Math.ceil(Math.max(box.maxX - box.minX, box.maxY - box.minY));
  }, [settings.housingLogo, groups, caps, whole]);
  const scale = layout && !layout.error ? layout.scale : 100;
  const keyOf = (index: number) => groups.findIndex((group) => group.includes(index));

  function toggle(index: number, join: boolean) {
    if (keyOf(index) >= 0) {
      patch({ housingParts: groups.map((group) => group.filter((entry) => entry !== index)).filter((group) => group.length) });
    } else if (join && groups.length) {
      patch({ housingParts: groups.map((group, key) => (key === groups.length - 1 ? [...group, index] : group)) });
    } else {
      patch({ housingParts: [...groups, [index]] });
    }
  }

  const box = bounds(parts.flatMap((part) => part.rings[0]).map((point) => ({ x: point.x * scale, y: point.y * scale })));
  const margin = (box.maxX - box.minX) * 0.06;
  const viewBox = `${box.minX - margin} ${-box.maxY - margin} ${box.maxX - box.minX + margin * 2} ${box.maxY - box.minY + margin * 2}`;
  const path = (rings: Pt[][]) =>
    rings
      .map((ring) => `M${ring.map((point) => `${(point.x * scale).toFixed(2)},${(-point.y * scale).toFixed(2)}`).join("L")}Z`)
      .join("");
  const housing = layout && !layout.error ? bounds(layout.outline) : null;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span>Clicker caps</span>
        <button
          type="button"
          hidden={whole}
          disabled={!groups.length}
          onClick={() => patch({ housingParts: [] })}
          className="h-8 rounded-lg border border-[#e6e7ec] bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      <div role="radiogroup" aria-label="Clicker caps" className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-xs">
        {(
          [
            { value: "whole", label: "Whole cap", hint: "One cap: the whole picture, shaped and colored like it." },
            { value: "parts", label: "By parts", hint: "Each part you pick is its own cap; the rest of the picture is the lid." },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={caps === option.value}
            title={option.hint}
            onClick={() => patch({ partCaps: option.value })}
            className={`h-8 rounded-md ${caps === option.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <svg
        viewBox={viewBox}
        className="mt-1 h-56 w-full select-none rounded-lg border border-[#e6e7ec] bg-[#fafafa]"
        onPointerLeave={() => setHovered(null)}
      >
        {parts.map((part, index) =>
          whole ? (
            <path key={index} d={path(part.rings)} fill={part.color} fillRule="evenodd" />
          ) : (
            <path
              key={index}
              role="button"
              aria-label={`Part ${index + 1}${keyOf(index) >= 0 ? `, clicker ${keyOf(index) + 1}` : ""}`}
              aria-pressed={keyOf(index) >= 0}
              d={path(part.rings)}
              fill={part.color}
              fillRule="evenodd"
              className="cursor-pointer"
              onPointerEnter={() => setHovered(index)}
              onClick={(event) => toggle(index, event.shiftKey)}
            />
          ),
        )}
        {whole && layout && !layout.error
          ? layout.keys.map((key, index) => (
              <path
                key={`cap-${index}`}
                d={key.cap.map((ring) => `M${ring.map((point) => `${point.x.toFixed(2)},${(-point.y).toFixed(2)}`).join("L")}Z`).join("")}
                fill="none"
                fillRule="evenodd"
                stroke="#2563eb"
                strokeWidth={2}
                strokeDasharray="6 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))
          : null}
        {!whole && groups.flatMap((group, key) =>
          group.map((index) => (
            <path
              key={`picked-${index}`}
              d={path(parts[index].rings)}
              fill="none"
              fillRule="evenodd"
              stroke={layout?.error ? "#ef4444" : "#2563eb"}
              strokeWidth={2.5}
              strokeDasharray={key % 2 ? "6 3" : undefined}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )),
        )}
        {hovered !== null && parts[hovered] ? (
          <path
            d={path(parts[hovered].rings)}
            fill="#ffffff"
            fillOpacity={0.35}
            fillRule="evenodd"
            stroke="#111827"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className="animate-pulse"
          />
        ) : null}
        {layout && !layout.error
          ? layout.positions.map((position, key) => (
              <g key={`switch-${key}`} pointerEvents="none">
                <rect
                  x={position.x - 8.2}
                  y={-position.y - 8.2}
                  width={16.4}
                  height={16.4}
                  rx={1}
                  fill="none"
                  stroke="#2563eb"
                  strokeOpacity={0.6}
                  strokeDasharray="3 2"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={position.x} cy={-position.y} r={3.2} fill="#2563eb" />
                <text x={position.x} y={-position.y} textAnchor="middle" dominantBaseline="central" fontSize={4} fill="#ffffff">
                  {key + 1}
                </text>
              </g>
            ))
          : null}
      </svg>
      {smallest ? (
        <label className="mt-2 flex items-center gap-2">
          <span>Size</span>
          <input
            aria-label="Clicker size"
            type="range"
            min={smallest}
            max={600}
            step={1}
            value={Math.max(smallest, settings.housingSize)}
            onChange={(event) => {
              const value = Number(event.target.value);
              patch({ housingSize: value <= smallest ? 0 : value });
            }}
            className="min-w-0 flex-1 accent-blue-600"
          />
          <input
            key={Math.max(smallest, settings.housingSize)}
            aria-label="Clicker size in mm"
            type="number"
            min={smallest}
            max={600}
            step={1}
            defaultValue={Math.max(smallest, settings.housingSize)}
            onBlur={(event) => {
              const value = Math.min(600, Math.round(Number(event.target.value) || 0));
              patch({ housingSize: value <= smallest ? 0 : value });
              event.target.value = String(Math.max(smallest, value));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="h-8 w-16 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
          />
          <span className="text-xs text-zinc-400">mm</span>
        </label>
      ) : null}
      {smallest ? <span className="block text-xs text-zinc-400">Smallest that fits the clickers: {smallest} mm.</span> : null}
      <span className={`mt-1 block text-xs ${layout?.error ? "text-red-500" : "text-zinc-400"}`}>
        {layout?.error ??
          (whole && housing
            ? `One cap of the whole picture, housing ${(housing.maxX - housing.minX).toFixed(0)} × ${(housing.maxY - housing.minY).toFixed(0)} mm. The dashed line is the cap's edge inside the rim and the square is the switch under it. Pick By parts to make separate clickers.`
            : housing
            ? `${groups.length} clicker${groups.length > 1 ? "s" : ""}, housing ${(housing.maxX - housing.minX).toFixed(0)} × ${(housing.maxY - housing.minY).toFixed(0)} mm. Click a part to add or remove a clicker; Shift+click joins a part to the last one. The dashed square is the switch under it.`
            : "Hover the picture and click a part to make it a clicker key, shaped and colored like that part. With none picked, the keys use your letters.")}
      </span>
    </div>
  );
}
