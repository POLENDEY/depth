"use client";

import { useMemo, useRef, useState } from "react";
import type { ProductSettings } from "@/lib/catalog";
import { bounds, type Pt } from "@/lib/clicker-layout";
import {
  clickerPlan,
  CUT,
  ensureSampleModel,
  importedModel,
  importModel,
  MAX_SIZE,
  MODEL_FORMATS,
  SAMPLE_MODEL,
  sliceRings,
  smallestSize,
  switchArea,
} from "@/lib/model-import";

type Props = {
  slug: string;
  label: string;
  settings: ProductSettings;
  patch: (partial: Partial<ProductSettings>) => void;
  onError: (message: string | null) => void;
};

const MAP_MARGIN = 4;

export function ModelField({ slug, label, settings, patch, onError }: Props) {
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState<{ offset: Pt; at: Pt } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const id = settings.modelId || SAMPLE_MODEL;

  const planned = useMemo(() => {
    try {
      ensureSampleModel();
      const least = smallestSize(id);
      const plan = clickerPlan(id, settings.housingSize, settings.modelCut, settings.modelSwitch);
      return { least, plan, section: sliceRings(plan, plan.cut), area: switchArea(plan), error: null };
    } catch (reason) {
      return { least: null, plan: null, section: [], area: [], error: reason instanceof Error ? reason.message : "Could not fit a switch." };
    }
  }, [id, settings.housingSize, settings.modelCut, settings.modelSwitch]);
  const { plan } = planned;
  const name = importedModel(id)?.name ?? "Star";

  async function onUpload(file: File) {
    setImporting(true);
    try {
      const modelId = await importModel(file);
      patch({ modelId, modelHole: null, modelCut: 0, modelSwitch: null });
      onError(null);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not read that 3D model.");
    } finally {
      setImporting(false);
    }
  }

  function toMap(event: React.PointerEvent): Pt | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: -point.y };
  }

  const box = planned.section.length ? bounds(planned.section.flat()) : null;
  const viewBox = box
    ? `${box.minX - MAP_MARGIN} ${-box.maxY - MAP_MARGIN} ${box.maxX - box.minX + MAP_MARGIN * 2} ${box.maxY - box.minY + MAP_MARGIN * 2}`
    : "0 0 1 1";
  const path = (rings: Pt[][]) =>
    rings.map((ring) => `M${ring.map((point) => `${point.x.toFixed(2)},${(-point.y).toFixed(2)}`).join("L")}Z`).join("");
  const at = dragging?.at ?? plan?.at ?? { x: 0, y: 0 };
  const half = CUT.hollow / 2;

  return (
    <div className="mb-3 text-sm text-zinc-600">
      <span>{label}</span>
      <input
        id={`${slug}-model-file`}
        type="file"
        accept={MODEL_FORMATS}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onUpload(file);
        }}
      />
      <div className="mt-1 flex items-center gap-2">
        <label
          htmlFor={`${slug}-model-file`}
          className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[#e6e7ec] bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          {importing ? "Reading model…" : "Upload 3D model"}
        </label>
        <span className="min-w-0 truncate text-xs text-zinc-500" title={name}>
          {settings.modelId ? name : `Sample: ${name}`}
        </span>
      </div>
      <span className="mt-1 block text-xs text-zinc-400">
        STL, OBJ, GLB, glTF, or 3MF, as a closed solid. It&apos;s cut flat in two: the top clicks down on a switch hidden in the bottom.
      </span>
      {planned.error ? <span className="mt-2 block text-xs text-red-500">{planned.error}</span> : null}

      {plan && planned.least ? (
        <SliderRow
          label="Object size"
          min={planned.least}
          max={MAX_SIZE}
          step={1}
          value={Math.round(plan.size)}
          onChange={(value) => patch({ housingSize: value })}
          hint={`Longest side from above. Smallest that still hides the switch: ${planned.least} mm.`}
        />
      ) : null}

      {plan && plan.cuts.length ? (
        <SliderRow
          label="Cut height"
          min={Math.floor(plan.cuts[0] * 2) / 2}
          max={Math.ceil(plan.cuts[plan.cuts.length - 1] * 2) / 2}
          step={0.5}
          value={Math.round(plan.cut * 2) / 2}
          onChange={(value) => patch({ modelCut: value / plan.height })}
          hint={`From the bottom, of ${plan.height.toFixed(0)} mm. Only heights where the switch fits are allowed; you can also drag the cut in the preview.`}
        />
      ) : null}

      {plan && box ? (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span>Switch spot</span>
            <button
              type="button"
              disabled={!settings.modelSwitch}
              onClick={() => patch({ modelSwitch: null })}
              className="h-8 rounded-lg border border-[#e6e7ec] bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              Auto
            </button>
          </div>
          <svg
            ref={svg}
            viewBox={viewBox}
            className="mt-1 h-44 w-full touch-none select-none rounded-lg border border-[#e6e7ec] bg-[#fafafa]"
            onPointerMove={(event) => {
              if (!dragging) return;
              const point = toMap(event);
              if (point) setDragging({ ...dragging, at: { x: point.x - dragging.offset.x, y: point.y - dragging.offset.y } });
            }}
            onPointerUp={() => {
              if (!dragging) return;
              patch({ modelSwitch: { x: dragging.at.x / plan.scale, y: dragging.at.y / plan.scale } });
              setDragging(null);
            }}
            onPointerCancel={() => setDragging(null)}
          >
            <path d={path(planned.section)} fill="#e4e4e7" fillRule="evenodd" stroke="#a1a1aa" strokeWidth={0.4} />
            <path d={path(planned.area)} fill="#2563eb" fillOpacity={0.12} fillRule="evenodd" />
            <g
              role="button"
              aria-label="Move the switch"
              className="cursor-grab"
              onPointerDown={(event) => {
                const point = toMap(event);
                if (!point) return;
                svg.current?.setPointerCapture(event.pointerId);
                setDragging({ offset: { x: point.x - at.x, y: point.y - at.y }, at });
              }}
            >
              <rect
                x={at.x - half}
                y={-at.y - half}
                width={half * 2}
                height={half * 2}
                rx={1}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={0.6}
                strokeDasharray="2 1"
              />
              <path
                d={`M${at.x - 2.1},${-at.y}H${at.x + 2.1}M${at.x},${-at.y - 2.1}V${-at.y + 2.1}`}
                stroke="#2563eb"
                strokeWidth={1.2}
                strokeLinecap="round"
              />
            </g>
          </svg>
          <span className="mt-1 block text-xs text-zinc-400">
            The slice at the cut. Drag the switch anywhere in the blue area; it snaps back in if it&apos;s too close to an edge.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  hint,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  const shown = Math.min(max, Math.max(min, value));
  return (
    <>
      <label className="mt-3 flex items-center gap-2">
        <span className="w-20 shrink-0">{label}</span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-blue-600"
        />
        <input
          key={shown}
          aria-label={`${label} in mm`}
          type="number"
          min={min}
          max={max}
          step={step}
          defaultValue={shown}
          onBlur={(event) => {
            const next = Math.min(max, Math.max(min, Number(event.target.value) || min));
            onChange(next);
            event.target.value = String(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="h-8 w-16 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
        />
        <span className="text-xs text-zinc-400">mm</span>
      </label>
      <span className="block text-xs text-zinc-400">{hint}</span>
    </>
  );
}
