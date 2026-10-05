"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CharmPicker } from "@/components/charm-picker";
import { FontField } from "@/components/font-field";
import { Viewer } from "@/components/viewer";
import { productBySlug, TAG_GROUPS, type ProductSettings, type TagShape } from "@/lib/catalog";
import { downloadBlob, EXPORT_FORMATS, exportKeychain, slugify, type ExportFormat } from "@/lib/export";
import { useFontLibrary } from "@/lib/font-library";
import { LIMITS, type KeychainModel } from "@/lib/geometry";
import { buildProduct } from "@/lib/models";
import { encodeSpotifyBars, fetchSpotifyBars } from "@/lib/spotify-code";
import { formatSize, fromDisplay, toDisplay, type Unit } from "@/lib/units";

export function MakerStudio({ slug }: { slug: string }) {
  const product = productBySlug(slug);
  const [settings, setSettings] = useState<ProductSettings | null>(product?.settings ?? null);
  const [unit, setUnit] = useState<Unit>("mm");
  const [format, setFormat] = useState<ExportFormat>("3mf");
  const [model, setModel] = useState<KeychainModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [spotifyNotice, setSpotifyNotice] = useState<{ tone: "ready" | "error"; text: string } | null>(null);
  const fonts = useFontLibrary();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const spotifyAttempt = useRef(0);

  const needsText = product?.fields.some((field) => field.type === "text") ?? false;
  const needsFont = product?.fields.some((field) => field.type === "font") ?? false;
  const geometryKey = useMemo(() => JSON.stringify({ slug, settings }), [slug, settings]);

  useEffect(() => {
    if (!model) return;
    return () => {
      model.text.dispose();
      model.base.dispose();
    };
  }, [model]);

  useEffect(() => {
    if (!product || !settings) return;
    const current = settings;
    let cancel = false;
    const attempt = spotifyAttempt.current;
    const timer = window.setTimeout(() => {
      if (needsText && !current.text.trim()) {
        if (!cancel) {
          setError(null);
          setBuilding(false);
        }
        return;
      }
      setBuilding(true);
      void (async () => {
        try {
          const font = needsFont ? await fonts.load(current.fontId) : null;
          if (cancel) return;
          const next = buildProduct(product.slug, font, current, "preview");
          if (cancel) {
            next.text.dispose();
            next.base.dispose();
            return;
          }
          setModel(next);
          if (spotifyAttempt.current === attempt) setError(null);
        } catch (reason) {
          if (!cancel) setError(reason instanceof Error ? reason.message : "Could not build that model.");
        } finally {
          if (!cancel) setBuilding(false);
        }
      })();
    }, 16);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [geometryKey, fonts.load, needsFont, needsText, product, settings]);

  if (!product || !settings) return null;
  const active = product;
  const current = settings;

  function patch(partial: Partial<ProductSettings>) {
    setSettings((previous) => (previous ? { ...previous, ...partial } : previous));
  }

  async function onGenerateSpotify() {
    const link = settingsRef.current?.text.trim() ?? "";
    if (!link) return;
    setGenerating(true);
    setError(null);
    setSpotifyNotice(null);
    try {
      const bars = await fetchSpotifyBars(link);
      setSpotifyNotice({ tone: "ready", text: "Code ready. This link is on the keychain." });
      patch({ spotifyBars: encodeSpotifyBars(bars) });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Spotify could not make a code for that link.";
      spotifyAttempt.current += 1;
      setSpotifyNotice({ tone: "error", text: message });
      setError(message);
    } finally {
      setGenerating(false);
    }
  }

  async function onDownload() {
    if (needsText && !current.text.trim()) return;
    setExporting(true);
    try {
      const font = needsFont ? await fonts.load(current.fontId) : null;
      const printModel = buildProduct(active.slug, font, current, "print");
      try {
        const file = await exportKeychain(
          printModel,
          format,
          current.textColor,
          current.baseColor,
          slugify(needsText ? current.text : active.slug),
          active.slug,
        );
        downloadBlob(file.blob, file.filename);
      } finally {
        printModel.text.dispose();
        printModel.base.dispose();
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export that file.");
    } finally {
      setExporting(false);
    }
  }

  async function onImportFont(file: File) {
    try {
      const id = await fonts.importFile(file);
      patch({ fontId: id });
    } catch (reason) {
      fonts.setError(reason instanceof Error ? reason.message : "Could not import that font.");
    }
  }

  function onDeleteFont(id: string) {
    const font = fonts.imported.find((entry) => entry.id === id);
    if (!font) return;
    if (!window.confirm(`Delete “${font.name}”?`)) return;
    void fonts.remove(id);
    if (current.fontId === id) patch({ fontId: "luckiest-guy" });
  }

  const visible = !needsText || settings.text.trim() ? model : null;
  const sizeLabel = visible ? formatSize(visible.width, visible.height, visible.depth, unit) : "— × — × —";
  const sizeOther = visible ? formatSize(visible.width, visible.height, visible.depth, unit === "mm" ? "in" : "mm") : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
      <section className="overflow-hidden rounded-2xl border border-[#e6e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="relative h-[min(68vh,620px)] min-h-[420px] bg-[#fbfbfd]">
          <Viewer
            model={visible}
            textColor={settings.textColor}
            baseColor={settings.baseColor}
            charmX={settings.charmX}
            charmY={settings.charmY}
            onCharmMove={slug === "magnet" && settings.charm ? (x, y) => patch({ charmX: x, charmY: y }) : undefined}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="rounded-xl bg-white/85 px-3 py-2 text-sm text-zinc-600 shadow-sm backdrop-blur">
              <p className="font-medium tabular-nums text-zinc-800" aria-live="polite">
                {sizeLabel}
              </p>
              {sizeOther ? <p className="text-xs tabular-nums text-zinc-500">{sizeOther}</p> : null}
              <p className="text-xs text-zinc-400">
                {slug === "magnet" && settings.charm
                  ? "Drag the icon to move it · Drag empty space to orbit"
                  : "Drag to orbit · Shift+drag to pan · Scroll to zoom"}
              </p>
            </div>
            <div className="pointer-events-auto flex items-center justify-end gap-2">
              <label className="sr-only" htmlFor={`${slug}-format`}>
                Download format
              </label>
              <select
                id={`${slug}-format`}
                value={format}
                onChange={(event) => setFormat(event.target.value as ExportFormat)}
                className="h-10 rounded-lg border border-[#e1e3e8] bg-white px-2 text-sm text-zinc-700"
              >
                {EXPORT_FORMATS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onDownload()}
                disabled={exporting || (needsText && !settings.text.trim())}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2f80ed] px-4 text-sm font-medium text-white shadow-sm hover:bg-[#1f6fd6] disabled:cursor-wait disabled:opacity-70"
              >
                {exporting ? "Preparing…" : `Download ${format.toUpperCase()}`}
              </button>
            </div>
          </div>
          {generating ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/60">
              <p className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm" role="status">
                Generating the Spotify code…
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="absolute top-3 left-3 z-10 max-w-sm rounded-lg bg-white px-3 py-2 text-sm text-red-600 shadow-sm">
              {error}
            </p>
          ) : null}
          {building && !error && !generating ? (
            <p className="absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs text-zinc-500 shadow-sm">
              Updating…
            </p>
          ) : null}
        </div>
        <p className="border-t border-[#f0f1f4] px-4 py-2 text-xs text-zinc-400">
          {visible?.warnings[0] ?? "STL, OBJ, and 3MF are millimeters. 3MF and GLB keep the two colors."}
        </p>
      </section>

      <aside className="controls rounded-2xl border border-[#e6e7ec] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:sticky lg:top-6">
        {product.fields.map((field) => {
          if (field.type === "spotify") {
            return (
              <div key="spotify" className="mb-3">
                <label className="block text-sm text-zinc-600" htmlFor={`${slug}-spotify`}>
                  {field.label}
                  <input
                    id={`${slug}-spotify`}
                    value={settings.text}
                    placeholder="https://open.spotify.com/track/..."
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      patch({ text: event.target.value });
                      setSpotifyNotice(null);
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-[#d7f3e4] bg-[#e7f9ef] px-3 text-sm text-zinc-900 outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void onGenerateSpotify()}
                  disabled={generating || !settings.text.trim()}
                  aria-busy={generating}
                  className="mt-2 h-10 w-full rounded-lg bg-[#1db954] text-sm font-medium text-white hover:bg-[#18a349] disabled:opacity-60"
                >
                  {generating ? "Generating…" : "Generate"}
                </button>
                <p
                  className={`mt-1 text-xs ${generating ? "font-medium text-zinc-700" : spotifyNotice?.tone === "error" ? "font-medium text-red-600" : spotifyNotice?.tone === "ready" ? "font-medium text-emerald-700" : "text-zinc-400"}`}
                  role="status"
                  aria-live="polite"
                >
                  {generating
                    ? "Generating the Spotify code…"
                    : spotifyNotice
                      ? spotifyNotice.text
                      : !settings.text.trim()
                        ? "Showing a sample code. Paste your link, then press Generate."
                        : "Press Generate to build this link into the keychain."}
                </p>
              </div>
            );
          }
          if (field.type === "back-text") {
            return (
              <label key="back-text" className="mb-3 block text-sm text-zinc-600" htmlFor={`${slug}-back-text`}>
                {field.label}
                <input
                  id={`${slug}-back-text`}
                  value={settings.backText}
                  maxLength={field.maxChars ?? 14}
                  placeholder="Name on the back"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => patch({ backText: event.target.value.slice(0, field.maxChars ?? 14) })}
                  style={{ fontFamily: `"${fonts.family(settings.fontId)}", system-ui, sans-serif` }}
                  className="mt-1 h-10 w-full rounded-lg border border-[#d7f3e4] bg-[#e7f9ef] px-3 text-base text-zinc-900 outline-none"
                />
              </label>
            );
          }
          if (field.type === "link-style") {
            return (
              <label key="link-style" className="mb-3 block text-sm text-zinc-600" htmlFor={`${slug}-link-style`}>
                {field.label}
                <select
                  id={`${slug}-link-style`}
                  value={settings.linkStyle}
                  onChange={(event) => patch({ linkStyle: event.target.value as ProductSettings["linkStyle"] })}
                  className="mt-1 h-10 w-full rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                >
                  <option value="tile">Tiles</option>
                  <option value="block">Blocks</option>
                </select>
                <span className="mt-1 block text-xs text-zinc-400">
                  Tiles are plates with a raised letter. Blocks are the letters themselves, joined by a bar through a round hole so each letter can pivot. Letter distance sets the space between letters.
                </span>
              </label>
            );
          }
          if (field.type === "text-flow") {
            return (
              <label key="text-flow" className="mb-3 block text-sm text-zinc-600" htmlFor={`${slug}-text-flow`}>
                {field.label}
                <select
                  id={`${slug}-text-flow`}
                  value={settings.textFlow}
                  onChange={(event) => patch({ textFlow: event.target.value as ProductSettings["textFlow"] })}
                  className="mt-1 h-10 w-full rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                >
                  <option value="vertical">Vertical</option>
                  <option value="horizontal">Horizontal</option>
                </select>
              </label>
            );
          }
          if (field.type === "relief") {
            return (
              <label key="relief" className="mb-3 block text-sm text-zinc-600" htmlFor={`${slug}-relief`}>
                {field.label}
                <select
                  id={`${slug}-relief`}
                  value={settings.relief}
                  onChange={(event) => patch({ relief: event.target.value as ProductSettings["relief"] })}
                  className="mt-1 h-10 w-full rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                >
                  <option value="embossed">Embossed</option>
                  <option value="debossed">Debossed</option>
                </select>
                <span className="mt-1 block text-xs text-zinc-400">
                  Embossed raises the code and the back text. Debossed presses both in. Each depth has its own slider.
                </span>
              </label>
            );
          }
          if (field.type === "text") {
            return (
              <label key="text" className="mb-3 block text-sm text-zinc-600" htmlFor={`${slug}-text`}>
                {field.label}
                <input
                  id={`${slug}-text`}
                  value={settings.text}
                  maxLength={field.maxChars ?? 24}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => patch({ text: event.target.value.slice(0, field.maxChars ?? 24) })}
                  style={{ fontFamily: `"${fonts.family(settings.fontId)}", system-ui, sans-serif` }}
                  className="mt-1 h-10 w-full rounded-lg border border-[#d7f3e4] bg-[#e7f9ef] px-3 text-base text-zinc-900 outline-none"
                />
              </label>
            );
          }
          if (field.type === "charm") {
            return (
              <div key="charm" className="mb-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-zinc-600">Icon</p>
                  <CharmPicker
                    value={settings.charm}
                    onChange={(charm) => patch({ charm, charmX: 0, charmY: 0 })}
                  />
                </div>
                {settings.charm ? (
                  <div className="mt-2">
                    <NumberRow
                      id={`${slug}-charm-size`}
                      label="Icon size"
                      unit={unit}
                      value={settings.charmSize}
                      min={LIMITS.charmSize[0]}
                      max={LIMITS.charmSize[1]}
                      step={0.5}
                      onUnit={setUnit}
                      onChange={(charmSize) => patch({ charmSize })}
                    />
                    <p className="text-xs text-zinc-400">Drag the icon in the preview. Emoji faces are filled line art.</p>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-zinc-400">Add an icon or emoji after the name.</p>
                )}
              </div>
            );
          }
          if (field.type === "font") {
            return (
              <div key="font" className="mb-3">
                <p className="mb-1 text-sm text-zinc-600">Font</p>
                <FontField
                  id={`${slug}-font`}
                  fontId={settings.fontId}
                  imported={fonts.imported}
                  error={fonts.error}
                  onChange={(fontId) => patch({ fontId })}
                  onImport={onImportFont}
                  onDelete={onDeleteFont}
                />
              </div>
            );
          }
          if (field.type === "number") {
            if (field.key === "linkHeight" && settings.linkStyle === "block") return null;
            if ((field.key === "linkSize" || field.key === "letterGap") && settings.linkStyle !== "block") return null;
            return (
              <NumberRow
                key={field.key}
                id={`${slug}-${field.key}`}
                label={field.label}
                unit={unit}
                value={settings[field.key] ?? (field.key === "linkSize" ? 6 : field.min)}
                min={field.min}
                max={field.max}
                step={field.step}
                onUnit={setUnit}
                onChange={(value) => patch({ [field.key]: value } as Partial<ProductSettings>)}
              />
            );
          }
          if (field.type === "shapes") {
            const group =
              TAG_GROUPS.find((entry) => entry.shapes.some((item) => item.value === settings.tagShape)) ??
              TAG_GROUPS[0];
            return (
              <div key="shapes" className="mb-3 grid gap-2">
                <label className="block text-sm text-zinc-600" htmlFor={`${slug}-shape-group`}>
                  Category
                  <select
                    id={`${slug}-shape-group`}
                    value={group.id}
                    onChange={(event) => {
                      const next = TAG_GROUPS.find((entry) => entry.id === event.target.value) ?? TAG_GROUPS[0];
                      patch({ tagShape: next.shapes[0].value });
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                  >
                    {TAG_GROUPS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-zinc-600" htmlFor={`${slug}-shape`}>
                  {field.label}
                  <select
                    id={`${slug}-shape`}
                    value={settings.tagShape}
                    onChange={(event) => patch({ tagShape: event.target.value as TagShape })}
                    className="mt-1 h-10 w-full rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                  >
                    {group.shapes.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          }
          if (field.type === "select") {
            return (
              <label key="pattern" className="mb-3 block text-sm text-zinc-600" htmlFor={`${slug}-pattern`}>
                {field.label}
                <select
                  id={`${slug}-pattern`}
                  value={settings.pattern}
                  onChange={(event) => patch({ pattern: event.target.value as ProductSettings["pattern"] })}
                  className="mt-1 h-10 w-full rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <div key="colors" className="mt-3 rounded-xl border border-[#eceef2] bg-[#fafafa] p-3">
              <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-zinc-400">COLORS</p>
              <ColorRow
                id={`${slug}-text-color`}
                label={field.text}
                value={settings.textColor}
                onChange={(textColor) => patch({ textColor })}
              />
              <ColorRow
                id={`${slug}-base-color`}
                label={field.base}
                value={settings.baseColor}
                onChange={(baseColor) => patch({ baseColor })}
              />
            </div>
          );
        })}
      </aside>
    </div>
  );
}

function NumberRow({
  id,
  label,
  unit,
  value,
  min,
  max,
  step,
  onUnit,
  onChange,
}: {
  id: string;
  label: string;
  unit: Unit;
  value: number;
  min: number;
  max: number;
  step: number;
  onUnit: (unit: Unit) => void;
  onChange: (mm: number) => void;
}) {
  const places = unit === "mm" ? 1 : 2;
  const shown = Math.round(toDisplay(value, unit) * 10 ** places) / 10 ** places;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 text-sm text-zinc-600">
      <label htmlFor={id}>{label}</label>
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={toDisplay(min, unit)}
          max={toDisplay(max, unit)}
          step={unit === "mm" ? step : 0.01}
          value={shown}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next)) return;
            const mm = fromDisplay(next, unit);
            onChange(Math.min(max, Math.max(min, mm)));
          }}
          className="h-10 w-24 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm tabular-nums"
        />
        <select
          aria-label={`${label} unit`}
          value={unit}
          onChange={(event) => onUnit(event.target.value as Unit)}
          className="h-10 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
        >
          <option value="mm">mm</option>
          <option value="in">in</option>
        </select>
      </span>
    </div>
  );
}

function ColorRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="mb-2 flex items-center gap-2 text-sm text-zinc-600">
      <input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="color-swatch" />
      {label}
    </label>
  );
}
