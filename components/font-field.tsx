"use client";

import { useRef } from "react";
import { FONTS } from "@/lib/fonts";
import { useFontLibrary, type ImportedFont } from "@/lib/font-library";

type FontFieldProps = {
  id: string;
  fontId: string;
  imported: ImportedFont[];
  error: string | null;
  onChange: (fontId: string) => void;
  onImport: (file: File) => Promise<void>;
  onDelete: (fontId: string) => void;
};

export function FontField({ id, fontId, imported, error, onChange, onImport, onDelete }: FontFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importedSelected = imported.some((font) => font.id === fontId);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <select
          id={id}
          value={fontId}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
        >
          <optgroup label="Built in">
            {FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.name}
              </option>
            ))}
          </optgroup>
          {imported.length ? (
            <optgroup label="Imported">
              {imported.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="h-10 shrink-0 rounded-lg border border-[#e6e7ec] px-2.5 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Import
        </button>
        {importedSelected ? (
          <button
            type="button"
            onClick={() => onDelete(fontId)}
            className="h-10 shrink-0 rounded-lg border border-[#fecaca] px-2.5 text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff"
        className="sr-only"
        aria-label="Import a font file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onImport(file);
        }}
      />
      <p className="mt-1 text-xs text-zinc-400">TTF, OTF, or WOFF. Imported fonts stay in this browser.</p>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function useFonts() {
  return useFontLibrary();
}
