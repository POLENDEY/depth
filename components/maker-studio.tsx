"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CharmPicker, CharmStrip } from "@/components/charm-picker";
import { ensureCharmArt } from "@/lib/charms";
import { FontField } from "@/components/font-field";
import { Viewer } from "@/components/viewer";
import { CostEstimate } from "@/components/cost-estimate";
import { HousingField } from "@/components/housing-field";
import { ModelField } from "@/components/model-field";
import { ensureManifold } from "@/lib/manifold";
import { partsMode } from "@/lib/clicker-layout";
import { LOOP_STYLES, productBySlug, SURFACE_PATTERNS, TAG_GROUPS, type ProductSettings, type TagShape } from "@/lib/catalog";
import { downloadBlob, EXPORT_FORMATS, exportKeychain, slugify, type ExportFormat } from "@/lib/export";
import { useFontLibrary } from "@/lib/font-library";
import { disposeModel, LIMITS, MAX_CHARMS, withCharm, type KeychainModel } from "@/lib/geometry";
import {
  importLogo,
  LOGO_EDGES,
  LOGO_TRACES,
  logoSource,
  reconvertLogo,
  type LogoEdges,
  type LogoTrace,
} from "@/lib/logo";
import { buildProduct } from "@/lib/models";
import { encodeSpotifyBars, fetchSpotifyBars } from "@/lib/spotify-code";
import { formatSize, fromDisplay, toDisplay, type Unit } from "@/lib/units";
import { UndoRedoControls } from "@/components/undo-redo-controls";
import { useUndoRedo } from "@/components/use-undo-redo";

// "Drag the cut or the keyring tab to move it · " for whichever can be dragged.
function dragHint(names: (string | null)[]) {
  const listed = names.filter((name): name is string => Boolean(name));
  if (!listed.length) return "";
  const last = listed.pop();
  return `Drag ${listed.length ? `${listed.join(", ")} or ${last}` : last} to move it · `;
}

export function MakerStudio({ slug }: { slug: string }) {
  const product = productBySlug(slug);
  const history = useUndoRedo<ProductSettings | null>(product?.settings ?? null);
  const settings = history.state;
  const setSettings = history.update;
  const [unit, setUnit] = useState<Unit>("mm");
  const [format, setFormat] = useState<ExportFormat>("3mf");
  const [model, setModel] = useState<KeychainModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedCharm, setSelectedCharm] = useState(0);
  const [importingLogo, setImportingLogo] = useState(false);
  const [showDimensions, setShowDimensions] = useState(false);
  const [spotifyNotice, setSpotifyNotice] = useState<{ tone: "ready" | "error"; text: string } | null>(null);
  const fonts = useFontLibrary();
  const spotifyAttempt = useRef(0);

  const needsText = product?.fields.some((field) => field.type === "text") ?? false;
  const needsFont = product?.fields.some((field) => field.type === "font") ?? false;
  const isModel = slug === "model-clicker";
  const geometryKey = useMemo(() => JSON.stringify({ slug, settings }), [slug, settings]);

  useEffect(() => {
    if (!model) return;
    return () => disposeModel(model);
  }, [model]);

  useEffect(() => {
    if (!product || !settings) return;
    const current = settings;
    let cancel = false;
    const attempt = spotifyAttempt.current;
    const timer = window.setTimeout(() => {
      if (needsText && !current.text.trim() && !current.charms.length && !partsMode(current)) {
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
          await Promise.all([...current.charms.map((charm) => charm.id), current.housingLogo].map(ensureCharmArt));
          if (product.slug === "model-clicker") await ensureManifold();
          if (cancel) return;
          const next = buildProduct(product.slug, font, current, "preview");
          if (cancel) {
            disposeModel(next);
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

  const selectedId = current.charms[Math.min(selectedCharm, current.charms.length - 1)]?.id ?? "";
  const selectedSource = selectedId ? logoSource(selectedId) : null;

  async function onImportLogo(file: File) {
    setImportingLogo(true);
    try {
      const id = await importLogo(file);
      const next = withCharm(current.charms, id, 40);
      if (next.length === current.charms.length) {
        setError(`You can add up to ${MAX_CHARMS} emojis and logos.`);
        return;
      }
      setSelectedCharm(next.length - 1);
      patch({ charms: next });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not convert that logo.");
    } finally {
      setImportingLogo(false);
    }
  }

  async function onLogoOptions(options: { edges?: LogoEdges; trace?: LogoTrace }) {
    if (!selectedId) return;
    setImportingLogo(true);
    try {
      const id = await reconvertLogo(selectedId, options);
      setSettings((previous) =>
        previous
          ? { ...previous, charms: previous.charms.map((charm) => (charm.id === selectedId ? { ...charm, id } : charm)) }
          : previous,
      );
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not convert that logo.");
    } finally {
      setImportingLogo(false);
    }
  }

  async function onGenerateSpotify() {
    const link = settings?.text.trim() ?? "";
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
    if (needsText && !current.text.trim() && !current.charms.length && !partsMode(current)) return;
    setExporting(true);
    try {
      const font = needsFont ? await fonts.load(current.fontId) : null;
      await Promise.all([...current.charms.map((charm) => charm.id), current.housingLogo].map(ensureCharmArt));
      if (active.slug === "model-clicker") await ensureManifold();
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
        disposeModel(printModel);
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

  const visible = !needsText || settings.text.trim() || settings.charms.length ? model : null;
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
            showDimensions={showDimensions}
            onToggleDimensions={() => setShowDimensions((current) => !current)}
            charms={settings.charms}
            onCharmMove={
              slug === "magnet" && settings.charms.length
                ? (index, x, y) => {
                    setSelectedCharm(index);
                    setSettings((previous) =>
                      previous
                        ? {
                            ...previous,
                            charms: previous.charms.map((charm, charmIndex) =>
                              charmIndex === index ? { ...charm, x, y } : charm,
                            ),
                          }
                        : previous,
                    );
                  }
                : undefined
            }
            holeX={settings.modelHole?.x ?? visible?.hole?.u ?? 0}
            holeY={settings.modelHole?.y ?? visible?.hole?.v ?? 0}
            onHoleMove={isModel && visible?.hole?.axis ? (x, y) => patch({ modelHole: { x, y } }) : undefined}
            onCutMove={
              isModel && visible?.cut
                ? (mm) => {
                    const cut = visible.cut!;
                    patch({ modelCut: Math.min(1, Math.max(0.01, mm / cut.height)) });
                  }
                : undefined
            }
            cutTilt={settings.modelCutTilt ?? 0}
            cutTurn={settings.modelCutTurn ?? 0}
            cutShare={settings.modelCut || 0.4}
            onCutTransform={
              isModel
                ? (tilt, turn, share) =>
                    patch({
                      modelCutTilt: tilt,
                      modelCutTurn: turn,
                      modelCut: share,
                      ...(tilt !== settings.modelCutTilt || turn !== settings.modelCutTurn
                        ? { modelSwitch: null, modelCutParts: null }
                        : {}),
                    })
                : undefined
            }
            onCutPiece={
              isModel && visible?.cutEditor
                ? (index) => {
                    const pieces = visible.cutEditor!.pieces;
                    const picked = pieces.map((piece, at) => (at === index ? !piece.cap : piece.cap));
                    if (!picked.some(Boolean)) return;
                    patch({ modelCutParts: pieces.filter((_, at) => picked[at]).map((piece) => piece.at) });
                  }
                : undefined
            }
            onLoopMove={isModel && visible?.loop ? (angle) => patch({ loopAngle: angle }) : undefined}
            onCutPick={
              isModel
                ? (tilt, turn, share, at) =>
                    patch({ modelCutTilt: tilt, modelCutTurn: turn, modelCut: share, modelSwitch: null, modelCutParts: [at] })
                : undefined
            }
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="rounded-xl bg-white/85 px-3 py-2 text-sm text-zinc-600 shadow-sm backdrop-blur">
              <p className="font-medium tabular-nums text-zinc-800" aria-live="polite">
                {sizeLabel}
              </p>
              {sizeOther ? <p className="text-xs tabular-nums text-zinc-500">{sizeOther}</p> : null}
              <p className="text-xs text-zinc-400">
                {slug === "magnet" && settings.charms.length
                  ? "Drag an emoji to move it · Drag empty space to orbit"
                  : isModel
                  ? `${dragHint([visible?.cut ? "the cut" : null, visible?.hole?.axis ? "the ring hole" : null, visible?.loop ? "the keyring tab" : null])}Edit cut to turn it or pick pieces`
                  : "Drag to orbit · Shift+drag to pan · Scroll to zoom"}
              </p>
            </div>
            <div className="pointer-events-auto flex items-center justify-end gap-2">
              <CostEstimate model={visible} modelName={active.title} />
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
                disabled={exporting || (needsText && !settings.text.trim() && !settings.charms.length && !partsMode(settings))}
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
        <UndoRedoControls
          onUndo={history.undo}
          onRedo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
        />
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
          if (field.type === "housing") {
            return (
              <HousingField key="housing" slug={slug} label={field.label} settings={settings} patch={patch} onError={setError} />
            );
          }
          if (field.type === "model") {
            return <ModelField key="model" slug={slug} label={field.label} settings={settings} patch={patch} onError={setError} />;
          }
          if (field.type === "surface") {
            return (
              <div key="surface" className="mb-3 text-sm text-zinc-600">
                <label htmlFor={`${slug}-surface`}>{field.label}</label>
                <div className="mt-1 flex gap-2">
                  <select
                    id={`${slug}-surface`}
                    value={settings.surface}
                    onChange={(event) => patch({ surface: event.target.value as ProductSettings["surface"] })}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                  >
                    {SURFACE_PATTERNS.map((pattern) => (
                      <option key={pattern.value} value={pattern.value}>
                        {pattern.label}
                      </option>
                    ))}
                  </select>
                  {settings.surface !== "plain" && (
                    <select
                      aria-label="Pattern on"
                      value={settings.surfaceOn}
                      onChange={(event) => patch({ surfaceOn: event.target.value as ProductSettings["surfaceOn"] })}
                      className="h-10 w-36 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                    >
                      <option value="both">Housing &amp; caps</option>
                      <option value="housing">Housing only</option>
                      <option value="caps">Caps only</option>
                    </select>
                  )}
                </div>
                {settings.surface !== "plain" && (
                  <span className="mt-1 block text-xs text-zinc-400">
                    Raised on the housing sides, engraved around the keycaps so they still slide freely.
                  </span>
                )}
              </div>
            );
          }
          if (field.type === "loop-style") {
            return (
              <div key="loop-style" className="mb-3 text-sm text-zinc-600">
                <label htmlFor={`${slug}-loop-style`}>{field.label}</label>
                <div className="mt-1 flex gap-2">
                  <select
                    id={`${slug}-loop-style`}
                    value={settings.loopStyle}
                    onChange={(event) => patch({ loopStyle: event.target.value as ProductSettings["loopStyle"] })}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                  >
                    {LOOP_STYLES.filter((style) => style.value !== "object" || isModel).map((style) => (
                      <option key={style.value} value={style.value}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                  {settings.loopStyle === "object" && (
                    <select
                      aria-label="Hole shape"
                      value={settings.modelHoleShape}
                      onChange={(event) =>
                        patch({ modelHoleShape: event.target.value as ProductSettings["modelHoleShape"], modelHole: null })
                      }
                      className="h-10 w-32 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                    >
                      <option value="torus">Curved (torus)</option>
                      <option value="straight">Straight</option>
                    </select>
                  )}
                  {settings.loopStyle !== "none" && settings.loopStyle !== "object" && (
                    <select
                      aria-label="Hole side"
                      value={settings.loopAngle != null ? "dragged" : settings.loopSide}
                      onChange={(event) => {
                        if (event.target.value === "dragged") return;
                        patch({ loopSide: event.target.value as ProductSettings["loopSide"], loopAngle: null });
                      }}
                      className="h-10 w-28 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
                    >
                      <option value="left">Left end</option>
                      <option value="right">Right end</option>
                      {settings.loopAngle != null ? <option value="dragged">Dragged ({settings.loopAngle}°)</option> : null}
                    </select>
                  )}
                </div>
                {settings.loopStyle === "object" && settings.modelHoleShape !== "straight" && (
                  <div className="mt-2 grid gap-2">
                    {(
                      [
                        {
                          key: "modelHoleTilt",
                          label: "Tilt",
                          max: 180,
                          describe: (value: number) =>
                            value === 0 ? "upright" : value === 90 ? "flat" : value === 180 ? "upside down" : `${value}°`,
                        },
                        { key: "modelHoleTurn", label: "Turn", max: 345, describe: (value: number) => `${value}°` },
                      ] as const
                    ).map(({ key, label, max, describe }) => (
                      <label key={key} className="flex items-center gap-3 text-xs text-zinc-500">
                        <span className="w-8 shrink-0">{label}</span>
                        <input
                          type="range"
                          min={0}
                          max={max}
                          step={15}
                          value={settings[key]}
                          aria-label={`Curved hole ${label.toLowerCase()}`}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            patch(key === "modelHoleTilt" ? { modelHoleTilt: value } : { modelHoleTurn: value });
                          }}
                          className="min-w-0 flex-1 accent-blue-600"
                        />
                        <span className="w-20 shrink-0 text-right tabular-nums">{describe(settings[key])}</span>
                      </label>
                    ))}
                    {(settings.modelHoleTilt !== 0 || settings.modelHoleTurn !== 0) && (
                      <button
                        type="button"
                        onClick={() => patch({ modelHoleTilt: 0, modelHoleTurn: 0 })}
                        className="justify-self-start text-xs text-blue-600 hover:underline"
                      >
                        Back to upright
                      </button>
                    )}
                  </div>
                )}
                {settings.loopStyle === "object" && (
                  <span className="mt-1 block text-xs text-zinc-400">
                    {settings.modelHoleShape === "straight"
                      ? "Bored straight through the object."
                      : "A curved tunnel that dips under the surface and comes back out, so the ring hangs from a bridge. Tilt lays it over (flat at 90°, so it opens on a side) and Turn spins it around."}{" "}
                    Drag the hole in the preview to move it. If it&apos;s in the cap, glue the cap onto the stem so the keyring can&apos;t pull it off.
                  </span>
                )}
              </div>
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
                    onAdd={(id) => {
                      const next = withCharm(settings.charms, id, 40);
                      if (next.length === settings.charms.length) {
                        setError(`You can add up to ${MAX_CHARMS} emojis.`);
                        return;
                      }
                      setSelectedCharm(next.length - 1);
                      patch({ charms: next });
                    }}
                    onClear={() => {
                      setSelectedCharm(0);
                      patch({ charms: [] });
                    }}
                  />
                </div>
                <CharmStrip
                  charms={settings.charms}
                  selected={selectedCharm}
                  onSelect={setSelectedCharm}
                  onRemove={(index) => {
                    const next = settings.charms.filter((_, charmIndex) => charmIndex !== index);
                    setSelectedCharm((currentIndex) =>
                      Math.max(0, Math.min(currentIndex > index ? currentIndex - 1 : currentIndex, next.length - 1)),
                    );
                    patch({ charms: next });
                  }}
                />
                {slug === "flexi-keychain" || slug === "clicker-keychain" ? (
                  <>
                    <input
                      id={`${slug}-logo-file`}
                      type="file"
                      accept=".svg,.png,image/svg+xml,image/png"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void onImportLogo(file);
                      }}
                    />
                    <label
                      htmlFor={`${slug}-logo-file`}
                      className="mt-2 inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#e6e7ec] bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
                    >
                      {importingLogo ? "Converting…" : "Import SVG or PNG"}
                    </label>
                    {selectedSource ? (
                      <div className="mt-2 grid gap-2">
                        <label className="flex items-center gap-2 text-sm text-zinc-600">
                          <span className="w-12">Raise</span>
                          <select
                            aria-label="Raise"
                            value={selectedSource.trace}
                            disabled={importingLogo}
                            onChange={(event) => void onLogoOptions({ trace: event.target.value as LogoTrace })}
                            className="h-9 flex-1 rounded-lg border border-[#e6e7ec] bg-white px-2 text-sm"
                          >
                            {LOGO_TRACES.map((entry) => (
                              <option key={entry.value} value={entry.value}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-zinc-600">
                          <span className="w-12">Edges</span>
                          <select
                            aria-label="Edges"
                            value={selectedSource.edges}
                            disabled={importingLogo}
                            onChange={(event) => void onLogoOptions({ edges: event.target.value as LogoEdges })}
                            className="h-9 flex-1 rounded-lg border border-[#e6e7ec] bg-white px-2 text-sm"
                          >
                            {LOGO_EDGES.map((entry) => (
                              <option key={entry.value} value={entry.value}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                    <p className="mt-1 text-xs text-zinc-400">
                      {slug === "flexi-keychain"
                        ? "Each emoji or logo gets its own bead after the letters, the same size as the others."
                        : "Each emoji or logo gets its own key after the letters. Line art only raises just the drawn lines of a logo."}
                    </p>
                  </>
                ) : settings.charms.length ? (
                  <div className="mt-2">
                    <NumberRow
                      id={`${slug}-charm-size`}
                      label="Icon size"
                      unit={unit}
                      value={settings.charms[Math.min(selectedCharm, settings.charms.length - 1)]?.size ?? 40}
                      min={LIMITS.charmSize[0]}
                      max={LIMITS.charmSize[1]}
                      step={0.5}
                      onUnit={setUnit}
                      onChange={(size) =>
                        patch({
                          charms: settings.charms.map((charm, index) =>
                            index === Math.min(selectedCharm, settings.charms.length - 1) ? { ...charm, size } : charm,
                          ),
                        })
                      }
                    />
                    <p className="text-xs text-zinc-400">Size of the selected emoji. Drag each one in the preview.</p>
                    <NumberRow
                      id={`${slug}-charm-base`}
                      label="Emoji base"
                      unit={unit}
                      value={settings.charmBase}
                      min={LIMITS.charmBase[0]}
                      max={LIMITS.charmBase[1]}
                      step={0.1}
                      onUnit={setUnit}
                      onChange={(charmBase) => patch({ charmBase })}
                    />
                    <p className="text-xs text-zinc-400">How far the base follows the emoji past the lines.</p>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-zinc-400">Add emojis after the name. You can add more than one.</p>
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
            if (field.key === "holeDiameter" && slug === "clicker-keychain" && settings.loopStyle === "none") return null;
            if (
              (field.key === "linkSize" || field.key === "letterGap") &&
              settings.linkStyle !== "block" &&
              slug !== "flexi-keychain"
            )
              return null;
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
