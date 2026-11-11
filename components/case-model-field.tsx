"use client";

import { useState } from "react";
import type { ProductSettings } from "@/lib/catalog";
import { CASE_SAMPLE, ensureCaseSample, importedModel, importModel, MODEL_FORMATS } from "@/lib/model-import";

type Props = {
  label: string;
  settings: ProductSettings;
  patch: (partial: Partial<ProductSettings>) => void;
  onError: (message: string | null) => void;
};

export function CaseModelField({ label, settings, patch, onError }: Props) {
  const [importing, setImporting] = useState(false);
  ensureCaseSample();
  const name = importedModel(settings.modelId || CASE_SAMPLE)?.name ?? "Rounded block";

  async function onUpload(file: File) {
    setImporting(true);
    try {
      const modelId = await importModel(file);
      patch({ modelId });
      onError(null);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not read that 3D model.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mb-3 text-sm text-zinc-600">
      <span>{label}</span>
      <input
        id="bottle-case-model-file"
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
          htmlFor="bottle-case-model-file"
          className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[#e6e7ec] bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          {importing ? "Reading and repairing…" : "Upload 3D model"}
        </label>
        <span className="min-w-0 truncate text-xs text-zinc-500" title={name}>
          {settings.modelId ? name : `Sample: ${name}`}
        </span>
        {settings.modelId ? (
          <button
            type="button"
            onClick={() => patch({ modelId: "" })}
            className="h-8 shrink-0 rounded-lg border border-[#e6e7ec] bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            Use sample
          </button>
        ) : null}
      </div>
      <span className="mt-1 block text-xs text-zinc-400">
        STL, OBJ, GLB, glTF, or 3MF, standing upright. It&apos;s cut flat into a housing (the bottom) and a cap (the top).
        Housing height and cap height below add up to the whole case closed: now {settings.caseHousingHeight} +{" "}
        {settings.caseCapHeight} = {settings.caseHousingHeight + settings.caseCapHeight} mm. Set Lip height to 0 for flat,
        flush faces with no step.
      </span>
      <label className="mt-3 flex items-center justify-between gap-2">
        <span>Keyring loop</span>
        <input
          type="checkbox"
          checked={settings.caseLoop}
          onChange={(event) => patch({ caseLoop: event.target.checked })}
          className="h-4 w-4 accent-blue-600"
        />
      </label>
      <span className="block text-xs text-zinc-400">
        A loop on top of the cap for a keyring. The cap then prints standing on its cut with the loop up.
      </span>
      <label className="mt-3 flex items-center justify-between gap-2">
        <span>Preview closed</span>
        <input
          type="checkbox"
          checked={settings.caseAssembled}
          onChange={(event) => patch({ caseAssembled: event.target.checked })}
          className="h-4 w-4 accent-blue-600"
        />
      </label>
      <span className="block text-xs text-zinc-400">
        Shows the cap on the housing. The download always lays both parts flat, side by side.
      </span>
    </div>
  );
}
