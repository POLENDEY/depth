"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Viewer } from "@/components/viewer";
import { CostEstimate } from "@/components/cost-estimate";
import { downloadBlob, EXPORT_FORMATS, exportKeychain, slugify, type ExportFormat } from "@/lib/export";
import { FontField } from "@/components/font-field";
import { useFontLibrary } from "@/lib/font-library";
import { CharmPicker, CharmStrip } from "@/components/charm-picker";
import { ensureCharmArt, isLogo } from "@/lib/charms";
import {
  emojiLineArt,
  importLogo,
  LOGO_EDGES,
  LOGO_TRACES,
  logoSource,
  reconvertLogo,
  type LogoEdges,
  type LogoTrace,
} from "@/lib/logo";
import { buildKeychain, LIMITS, MAX_CHARMS, withCharm, type HoleSide, type KeychainModel, type KeychainParams } from "@/lib/geometry";
import { formatSize, fromDisplay, toDisplay, type Unit } from "@/lib/units";
import { UndoRedoControls } from "@/components/undo-redo-controls";
import { useUndoRedo } from "@/components/use-undo-redo";

type Settings = KeychainParams & {
  fontId: string;
  textColor: string;
  lineColors: string[];
  baseColor: string;
};

const INITIAL: Settings = {
  text: "PAUL",
  fontId: "luckiest-guy",
  letterHeight: 18,
  lineHeights: [],
  lineSpacing: 4,
  outline: 2.4,
  holeEnabled: true,
  holeDiameter: 5,
  holeSide: "left",
  holeOffsetX: 0,
  holeOffsetY: 0,
  baseThickness: 2.4,
  textThickness: 1.6,
  charms: [],
  charmBase: 1.2,
  textColor: "#f4f4f5",
  lineColors: [],
  baseColor: "#8b78f2",
};

const PRESETS = [
  { id: "mini", label: "Mini", letterHeight: 12 },
  { id: "standard", label: "Standard", letterHeight: 18 },
  { id: "large", label: "Large", letterHeight: 26 },
];

export function Studio() {
  const history = useUndoRedo(INITIAL);
  const settings = history.state;
  const setSettings = history.update;
  const [unit, setUnit] = useState<Unit>("mm");
  const [format, setFormat] = useState<ExportFormat>("3mf");
  const [model, setModel] = useState<KeychainModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [more, setMore] = useState(false);
  const [selectedCharm, setSelectedCharm] = useState(0);
  const [showDimensions, setShowDimensions] = useState(false);
  const [importingLogo, setImportingLogo] = useState(false);
  const fonts = useFontLibrary();
  const hasContent = Boolean(settings.text.trim() || settings.charms.length);

  const geometryKey = useMemo(
    () =>
      JSON.stringify({
        text: settings.text,
        fontId: settings.fontId,
        letterHeight: settings.letterHeight,
        lineHeights: settings.lineHeights,
        lineSpacing: settings.lineSpacing,
        outline: settings.outline,
        holeEnabled: settings.holeEnabled,
        holeDiameter: settings.holeDiameter,
        holeSide: settings.holeSide,
        holeOffsetX: settings.holeOffsetX,
        holeOffsetY: settings.holeOffsetY,
        baseThickness: settings.baseThickness,
        textThickness: settings.textThickness,
        charms: settings.charms,
        charmBase: settings.charmBase,
      }),
    [settings],
  );

  useEffect(() => {
    if (!model) return;
    return () => {
      model.text.dispose();
      model.base.dispose();
    };
  }, [model]);

  useEffect(() => {
    const params = JSON.parse(geometryKey) as KeychainParams & { fontId: string };
    let cancel = false;
    const timer = window.setTimeout(() => {
      if (!params.text.trim() && !params.charms.length) {
        if (!cancel) {
          setError(null);
          setBuilding(false);
        }
        return;
      }
      setBuilding(true);
      void (async () => {
        try {
          const font = await fonts.load(params.fontId);
          await Promise.all(params.charms.map((charm) => ensureCharmArt(charm.id)));
          if (cancel) return;
          const next = buildKeychain(font, params, "preview");
          if (cancel) {
            next.text.dispose();
            next.base.dispose();
            return;
          }
          setModel(next);
          setError(null);
        } catch (reason) {
          if (!cancel) {
            setError(reason instanceof Error ? reason.message : "Could not build that keychain.");
          }
        } finally {
          if (!cancel) setBuilding(false);
        }
      })();
    }, 16);

    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [geometryKey, fonts.load]);

  async function onDownload() {
    if (!hasContent) return;
    setExporting(true);
    try {
      const font = await fonts.load(settings.fontId);
      await Promise.all(settings.charms.map((charm) => ensureCharmArt(charm.id)));
      const printModel = buildKeychain(font, settings, "print");
      try {
        const file = await exportKeychain(
          printModel,
          format,
          settings.textColor,
          settings.baseColor,
          slugify(settings.text),
          "keychain",
          settings.lineColors,
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

  function patch(partial: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...partial }));
  }

  const activeFamily = fonts.family(settings.fontId);

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
    if (!window.confirm(`Delete “${font.name}”? Models using it will fall back to Luckiest Guy.`)) return;
    void fonts.remove(id);
    if (settings.fontId === id) patch({ fontId: "luckiest-guy" });
  }
  async function onImportLogo(file: File) {
    setImportingLogo(true);
    try {
      const id = await importLogo(file);
      const next = withCharm(settings.charms, id, settings.letterHeight * 1.42);
      if (next.length === settings.charms.length) {
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

  const selectedIndex = Math.min(selectedCharm, settings.charms.length - 1);
  const selectedId = settings.charms[selectedIndex]?.id ?? "";
  const selectedSource = selectedId ? logoSource(selectedId) : null;
  const selectedEmoji = selectedId && !isLogo(selectedId) ? selectedId : (selectedSource?.emoji ?? null);
  const raise = selectedSource ? selectedSource.trace : selectedEmoji ? "emoji" : null;
  const raiseOptions = selectedEmoji
    ? [
        { value: "emoji", label: "Emoji style" },
        { value: "lines", label: "Line art only" },
      ]
    : LOGO_TRACES;

  async function onLogoOptions(options: { edges?: LogoEdges; trace?: LogoTrace | "emoji" }) {
    if (!selectedId) return;
    setImportingLogo(true);
    try {
      let id: string;
      if (options.trace === "emoji") id = selectedEmoji ?? selectedId;
      else if (!selectedSource && selectedEmoji) id = await emojiLineArt(selectedEmoji);
      else id = await reconvertLogo(selectedId, options as { edges?: LogoEdges; trace?: LogoTrace });
      setSettings((current) => ({
        ...current,
        charms: current.charms.map((charm) => (charm.id === selectedId ? { ...charm, id } : charm)),
      }));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not convert that logo.");
    } finally {
      setImportingLogo(false);
    }
  }

  const lines = settings.text.replace(/\r\n?/g, "\n").split("\n");
  const visibleModel = hasContent ? model : null;
  const unitStep = unit === "mm" ? 0.1 : 0.01;
  const sizeLabel = visibleModel
    ? formatSize(visibleModel.width, visibleModel.height, visibleModel.depth, "mm")
    : "— × — × — mm";
  const sizeInches = visibleModel
    ? formatSize(visibleModel.width, visibleModel.height, visibleModel.depth, "in")
    : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
      <section className="overflow-hidden rounded-2xl border border-[#e6e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="relative h-[min(68vh,620px)] min-h-[420px] bg-[#fbfbfd]">
          <Viewer
            model={visibleModel}
            textColor={settings.textColor}
            baseColor={settings.baseColor}
            lineColors={settings.lineColors}
            charms={settings.charms}
            onCharmMove={
              settings.charms.length
                ? (index, x, y) => {
                    setSelectedCharm(index);
                    setSettings((current) => ({
                      ...current,
                      charms: current.charms.map((charm, charmIndex) =>
                        charmIndex === index ? { ...charm, x, y } : charm,
                      ),
                    }));
                  }
                : undefined
            }
            holeX={settings.holeOffsetX}
            holeY={settings.holeOffsetY}
            onHoleMove={
              settings.holeEnabled
                ? (x, y) => patch({ holeOffsetX: x, holeOffsetY: y })
                : undefined
            }
            showDimensions={showDimensions}
            onToggleDimensions={() => setShowDimensions((visible) => !visible)}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="pointer-events-none rounded-xl bg-white/85 px-3 py-2 text-sm text-zinc-600 shadow-sm backdrop-blur">
              <p className="font-medium tabular-nums text-zinc-800" aria-live="polite">
                {sizeLabel}
              </p>
              {sizeInches ? <p className="text-xs tabular-nums text-zinc-500">{sizeInches}</p> : null}
              <p className="text-xs text-zinc-400">
                {settings.charms.length
                  ? "Drag an emoji or the keyring hole on its own · Drag empty space to orbit"
                  : settings.holeEnabled
                    ? "Drag the keyring hole to move it · Drag empty space to orbit"
                    : "Drag to orbit · Shift+drag to pan · Scroll to zoom"}
              </p>
            </div>
            <div className="pointer-events-auto flex items-center justify-end gap-2">
              <CostEstimate model={visibleModel} modelName="Name keychain" />
              <label className="sr-only" htmlFor="export-format">
                Download format
              </label>
              <select
                id="export-format"
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
                disabled={exporting || !hasContent}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2f80ed] px-4 text-sm font-medium text-white shadow-sm hover:bg-[#1f6fd6] disabled:cursor-wait disabled:opacity-70"
              >
                <DownloadIcon />
                {exporting ? "Preparing…" : `Download ${format.toUpperCase()}`}
              </button>
            </div>
          </div>
          {error ? (
            <p className="absolute top-3 left-3 max-w-sm rounded-lg bg-white px-3 py-2 text-sm text-red-600 shadow-sm">
              {error}
            </p>
          ) : null}
          {building && !error ? (
            <p className="absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs text-zinc-500 shadow-sm">
              Updating…
            </p>
          ) : null}
        </div>
        {visibleModel?.warnings.length ? (
          <p className="border-t border-[#f0f1f4] px-4 py-2 text-xs text-amber-700">{visibleModel.warnings[0]}</p>
        ) : (
          <p className="border-t border-[#f0f1f4] px-4 py-2 text-xs text-zinc-400">
            STL, OBJ, and 3MF are millimeters, lying flat for the print bed. 3MF and GLB keep every color, including each line color.
          </p>
        )}
      </section>

      <aside className="controls rounded-2xl border border-[#e6e7ec] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:sticky lg:top-6">
        <UndoRedoControls
          onUndo={history.undo}
          onRedo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
        />
        <Field label="Name" htmlFor="keychain-name">
          <div className="flex items-start gap-1.5">
            <textarea
              id="keychain-name"
              value={settings.text}
              maxLength={LIMITS.characters}
              rows={2}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => patch({ text: event.target.value.slice(0, LIMITS.characters) })}
              style={{ fontFamily: `"${activeFamily}", system-ui, sans-serif` }}
              className="min-h-16 min-w-0 flex-1 resize-none rounded-lg border border-[#d7f3e4] bg-[#e7f9ef] px-3 py-2 text-base leading-6 text-zinc-900 outline-none focus:border-[#8ed4ad] focus:bg-[#dff6e8]"
            />
            <CharmPicker
              onAdd={(id) => {
                const next = withCharm(settings.charms, id, 26);
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
            <button
              type="button"
              aria-label="Reset name"
              onClick={() => patch({ text: "PAUL" })}
              className="grid h-10 w-10 place-items-center rounded-lg border border-[#e6e7ec] text-zinc-500 hover:bg-zinc-50"
            >
              <ResetIcon />
            </button>
          </div>
          <CharmStrip
            charms={settings.charms}
            selected={selectedCharm}
            onSelect={setSelectedCharm}
            onRemove={(index) => {
              const next = settings.charms.filter((_, charmIndex) => charmIndex !== index);
              setSelectedCharm((current) => Math.max(0, Math.min(current > index ? current - 1 : current, next.length - 1)));
              patch({ charms: next });
            }}
          />
          <p className="mt-1 text-xs text-zinc-400">Press Enter to add a line.</p>
        </Field>
        <Field label="Line gap" htmlFor="line-spacing">
          <div className="flex items-center gap-2">
            <input
              id="line-spacing"
              type="number"
              inputMode="decimal"
              min={toDisplay(LIMITS.lineSpacing[0], unit)}
              max={toDisplay(LIMITS.lineSpacing[1], unit)}
              step={unit === "mm" ? 0.5 : 0.02}
              value={displayNumber(settings.lineSpacing, unit)}
              onChange={(event) =>
                commitNumber(event.target.value, unit, LIMITS.lineSpacing, (lineSpacing) =>
                  patch({ lineSpacing }),
                )
              }
              className="h-10 w-24 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-3 text-sm tabular-nums"
            />
            <span className="text-sm text-zinc-500">{unit}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">Vertical gap between lines. Set 0 for tightly stacked lines.</p>
        </Field>

        <Field label="Font" htmlFor="keychain-font">
          <FontField
            id="keychain-font"
            fontId={settings.fontId}
            imported={fonts.imported}
            error={fonts.error}
            onChange={(fontId) => patch({ fontId })}
            onImport={onImportFont}
            onDelete={onDeleteFont}
          />
        </Field>

        <button
          type="button"
          onClick={() => setMore((open) => !open)}
          className="mb-2 ml-[5.25rem] text-sm text-[#2f80ed] hover:underline"
        >
          {more ? "Hide extra options" : "Show more options"}
        </button>
        {more ? (
          <p className="mb-3 ml-[5.25rem] text-xs leading-5 text-zinc-500">
            The plus button adds emojis, and you can add more than one. Artwork is the OpenMoji line drawing, CC BY-SA 4.0. Drag each emoji in the preview. Reset restores the sample name.
          </p>
        ) : null}

        <Field label="Size" htmlFor="letter-height">
          <div className="flex items-center gap-2">
            <input
              id="letter-height"
              type="number"
              inputMode="decimal"
              min={toDisplay(LIMITS.letterHeight[0], unit)}
              max={toDisplay(LIMITS.letterHeight[1], unit)}
              step={unit === "mm" ? 0.5 : 0.02}
              value={displayNumber(settings.letterHeight, unit)}
              onChange={(event) =>
                commitNumber(event.target.value, unit, LIMITS.letterHeight, (letterHeight) =>
                  patch({ letterHeight, lineHeights: [] }),
                )
              }
              className="h-10 w-24 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-3 text-sm tabular-nums"
            />
            <select
              aria-label="Size unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value as Unit)}
              className="h-10 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-2 text-sm"
            >
              <option value="mm">mm</option>
              <option value="in">in</option>
            </select>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Letter height · {unit === "mm" ? `${(settings.letterHeight / 25.4).toFixed(2)} in` : `${settings.letterHeight.toFixed(1)} mm`}
          </p>
        </Field>

        <div className="mt-1 flex flex-wrap gap-1.5 pl-[5.25rem]">
          {PRESETS.map((preset) => {
            const active = Math.abs(settings.letterHeight - preset.letterHeight) < 0.2;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => patch({ letterHeight: preset.letterHeight, lineHeights: [] })}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {lines.length > 1 ? (
          <div className="mt-2 grid gap-1.5 rounded-xl border border-[#eceef2] bg-[#fafafa] p-3">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400">LINES</p>
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2 text-sm text-zinc-600">
                <span className="w-14 shrink-0">{index === 0 ? "Top" : index === lines.length - 1 ? "Bottom" : `Line ${index + 1}`}</span>
                <input
                  type="color"
                  aria-label={`Color of line ${index + 1}`}
                  value={settings.lineColors[index] || settings.textColor}
                  onChange={(event) =>
                    patch({
                      lineColors: lines.map((_, lineIndex) =>
                        lineIndex === index ? event.target.value : settings.lineColors[lineIndex] || "",
                      ),
                    })
                  }
                  className="color-swatch shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{line.trim() || "(empty)"}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label={`Letter height of line ${index + 1}`}
                  min={toDisplay(LIMITS.letterHeight[0], unit)}
                  max={toDisplay(LIMITS.letterHeight[1], unit)}
                  step={unit === "mm" ? 0.5 : 0.02}
                  value={displayNumber(settings.lineHeights?.[index] || settings.letterHeight, unit)}
                  onChange={(event) =>
                    commitNumber(event.target.value, unit, LIMITS.letterHeight, (height) =>
                      patch({
                        lineHeights: lines.map((_, lineIndex) =>
                          lineIndex === index ? height : settings.lineHeights?.[lineIndex] || 0,
                        ),
                      }),
                    )
                  }
                  className="h-9 w-20 rounded-lg border border-[#e6e7ec] bg-white px-2 text-sm tabular-nums"
                />
                <span className="w-6 text-xs text-zinc-400">{unit}</span>
              </div>
            ))}
            <p className="text-xs text-zinc-400">Set the color and letter height of each line on its own. Size above resets the height of every line. Emojis and logos keep the Text color.</p>
          </div>
        ) : null}

        <Field label="Logo" htmlFor="logo-file">
          <input
            id="logo-file"
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
            htmlFor="logo-file"
            className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[#e6e7ec] bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            {importingLogo ? "Converting…" : "Import SVG or PNG"}
          </label>
          <p className="mt-1 text-xs text-zinc-400">
            The logo becomes raised 3D in the text color, on the base. Drag it in the preview, and set its size below.
          </p>
          {raise ? (
            <>
              <label className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
                <span className="w-12">Raise</span>
                <select
                  aria-label="Raise"
                  value={raise}
                  disabled={importingLogo}
                  onChange={(event) => void onLogoOptions({ trace: event.target.value as LogoTrace | "emoji" })}
                  className="h-9 flex-1 rounded-lg border border-[#e6e7ec] bg-white px-2 text-sm"
                >
                  {raiseOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedSource ? (
                <label className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
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
              ) : null}
              <p className="mt-1 text-xs text-zinc-400">
                For the selected emoji or logo. Line art only raises just the drawn black lines and ignores color fills;
                the base follows the whole drawing. Smooth turns pixel stair steps into clean curves.
              </p>
            </>
          ) : null}
        </Field>

        {settings.charms.length ? (
          <Field label="Icon" htmlFor="icon-size">
            <div className="flex items-center gap-2">
              <input
                id="icon-size"
                type="number"
                inputMode="decimal"
                min={toDisplay(LIMITS.charmSize[0], unit)}
                max={toDisplay(LIMITS.charmSize[1], unit)}
                step={unit === "mm" ? 0.5 : 0.02}
                value={displayNumber(settings.charms[Math.min(selectedCharm, settings.charms.length - 1)]?.size ?? 26, unit)}
                onChange={(event) =>
                  commitNumber(event.target.value, unit, LIMITS.charmSize, (size) =>
                    patch({
                      charms: settings.charms.map((charm, index) =>
                        index === Math.min(selectedCharm, settings.charms.length - 1) ? { ...charm, size } : charm,
                      ),
                    }),
                  )
                }
                className="h-10 w-24 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-3 text-sm tabular-nums"
              />
              <span className="text-sm text-zinc-500">{unit}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Size of the selected emoji or logo. Drag each one in the preview to move it.
            </p>
          </Field>
        ) : null}

        {settings.charms.length ? (
          <Field label="Emoji base" htmlFor="emoji-base">
            <div className="flex items-center gap-2">
              <input
                id="emoji-base"
                type="number"
                inputMode="decimal"
                min={toDisplay(LIMITS.charmBase[0], unit)}
                max={toDisplay(LIMITS.charmBase[1], unit)}
                step={unit === "mm" ? 0.1 : 0.01}
                value={displayNumber(settings.charmBase, unit)}
                onChange={(event) =>
                  commitNumber(event.target.value, unit, LIMITS.charmBase, (charmBase) => patch({ charmBase }))
                }
                className="h-10 w-24 rounded-lg border border-[#e6e7ec] bg-[#fafafa] px-3 text-sm tabular-nums"
              />
              <span className="text-sm text-zinc-500">{unit}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              How far the base follows the emoji past the lines. The lines stay the text color.
            </p>
          </Field>
        ) : null}

        <Disclosure title="Outline" value={formatCompact(settings.outline, unit)}>
          <NumberField
            id="outline-width"
            label="Border"
            unit={unit}
            value={settings.outline}
            min={LIMITS.outline[0]}
            max={LIMITS.outline[1]}
            step={unitStep}
            onChange={(outline) => patch({ outline })}
          />
          <p className="text-xs leading-5 text-zinc-500">
            This is the colored rim around the letters. It is part of the base layer.
          </p>
        </Disclosure>

        <Disclosure title="Hole" value={settings.holeEnabled ? formatCompact(settings.holeDiameter, unit) : "Off"}>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={settings.holeEnabled}
              onChange={(event) => patch({ holeEnabled: event.target.checked })}
            />
            Keyring hole
          </label>
          <NumberField
            id="hole-diameter"
            label="Diameter"
            unit={unit}
            value={settings.holeDiameter}
            min={LIMITS.holeDiameter[0]}
            max={LIMITS.holeDiameter[1]}
            step={unitStep}
            onChange={(holeDiameter) => patch({ holeDiameter })}
          />
          <div className="flex gap-2">
            {(["left", "right"] as HoleSide[]).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => patch({ holeSide: side, holeOffsetX: 0, holeOffsetY: 0 })}
                className={`h-8 flex-1 rounded-lg border text-sm capitalize ${
                  settings.holeSide === side
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-[#e6e7ec] text-zinc-600"
                }`}
              >
                {side}
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-zinc-500">
            Drag the hole in the preview. Moving an icon does not move the hole.
          </p>
        </Disclosure>

        <div className="mt-3 rounded-xl border border-[#eceef2] bg-[#fafafa] p-3">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-zinc-400">3D LAYERS</p>
          <LayerRow
            label="Text"
            color={settings.textColor}
            onColor={(textColor) => patch({ textColor })}
            unit={unit}
            thickness={settings.textThickness}
            min={LIMITS.textThickness[0]}
            max={LIMITS.textThickness[1]}
            onThickness={(textThickness) => patch({ textThickness })}
          />
          <LayerRow
            label="Base"
            color={settings.baseColor}
            onColor={(baseColor) => patch({ baseColor })}
            unit={unit}
            thickness={settings.baseThickness}
            min={LIMITS.baseThickness[0]}
            max={LIMITS.baseThickness[1]}
            onThickness={(baseThickness) => patch({ baseThickness })}
          />
          <p className="mt-2 text-xs text-zinc-500">
            Total thickness {formatCompact(settings.baseThickness + settings.textThickness, unit)}. A keychain is
            usually about 3–5 mm thick.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 py-1.5">
      <label htmlFor={htmlFor} className="pt-2.5 text-sm text-zinc-600">
        {label}
      </label>
      <div>{children}</div>
    </div>
  );
}

function Disclosure({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-[#f0f1f4] py-1">
      <summary className="flex cursor-pointer items-center gap-3 py-2.5 text-sm">
        <span className="w-[4.5rem] text-zinc-700">{title}</span>
        <span className="flex-1 text-zinc-400">{value}</span>
        <Chevron />
      </summary>
      <div className="grid gap-3 pb-3 pl-[5.25rem]">{children}</div>
    </details>
  );
}

function NumberField({
  id,
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  unit: Unit;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (mm: number) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm text-zinc-600">
      {label}
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={toDisplay(min, unit)}
          max={toDisplay(max, unit)}
          step={step}
          value={displayNumber(value, unit)}
          onChange={(event) => commitNumber(event.target.value, unit, [min, max], onChange)}
          className="h-9 w-20 rounded-lg border border-[#e6e7ec] bg-white px-2 text-sm tabular-nums"
        />
        <span className="w-6 text-xs text-zinc-400">{unit}</span>
      </span>
    </label>
  );
}

function LayerRow({
  label,
  color,
  onColor,
  unit,
  thickness,
  min,
  max,
  onThickness,
}: {
  label: string;
  color: string;
  onColor: (color: string) => void;
  unit: Unit;
  thickness: number;
  min: number;
  max: number;
  onThickness: (mm: number) => void;
}) {
  const colorId = `${label.toLowerCase()}-color`;
  const thicknessId = `${label.toLowerCase()}-thickness`;
  return (
    <div className="mb-2 flex items-center gap-2">
      <label htmlFor={colorId} className="sr-only">
        {label} color
      </label>
      <input
        id={colorId}
        type="color"
        value={color}
        onChange={(event) => onColor(event.target.value)}
        className="color-swatch"
      />
      <span className="w-10 text-sm text-zinc-600">{label}</span>
      <label htmlFor={thicknessId} className="sr-only">
        {label} thickness
      </label>
      <input
        id={thicknessId}
        type="number"
        inputMode="decimal"
        min={toDisplay(min, unit)}
        max={toDisplay(max, unit)}
        step={unit === "mm" ? 0.1 : 0.01}
        value={displayNumber(thickness, unit)}
        onChange={(event) => commitNumber(event.target.value, unit, [min, max], onThickness)}
        className="h-9 w-20 rounded-lg border border-[#e6e7ec] bg-white px-2 text-sm tabular-nums"
      />
      <span className="text-xs text-zinc-400">{unit}</span>
    </div>
  );
}

function displayNumber(mm: number, unit: Unit) {
  const places = unit === "mm" ? 1 : 2;
  const factor = 10 ** places;
  return String(Math.round(toDisplay(mm, unit) * factor) / factor);
}

function commitNumber(
  raw: string,
  unit: Unit,
  range: readonly [number, number],
  onChange: (mm: number) => void,
) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  const mm = fromDisplay(value, unit);
  onChange(Math.min(range[1], Math.max(range[0], mm)));
}

function formatCompact(mm: number, unit: Unit) {
  if (unit === "mm") return `${mm.toFixed(1)} mm`;
  return `${(mm / 25.4).toFixed(2)} in`;
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M8 2.5v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5.2 7.2 8 10l2.8-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 12.5h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M13 8a5 5 0 1 1-1.4-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12.8 2.8v2.6H10.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="text-zinc-400 transition-transform group-open:rotate-180"
    >
      <path d="M3 5.2 7 9l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
