"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import type { KeychainModel } from "@/lib/geometry";
import { MODEL_FORMATS, readModelFile } from "@/lib/model-import";
import { CARD_PICTURE, priceCardImage, QUOTE_PICTURE, quoteImage } from "@/lib/quote-image";
import { ModelPreview, type PreviewHandle, type PreviewPart } from "./model-preview";
import {
  ALL_INCLUDED,
  BAMBU_A1,
  calculateCost,
  costProblems,
  DEFAULT_COST_INPUTS,
  estimateGrams,
  formatPeso,
  measureMesh,
  wearPerHour,
  type CostBreakdown,
  type CostInputs,
  type CostLine,
  type Included,
  type PricingMethod,
  type PrinterProfile,
} from "@/lib/print-cost";

type CostSettings = {
  filamentPrice: string;
  waste: string;
  quantity: string;
  setupMinutes: string;
  laborRate: string;
  finishingMinutes: string;
  hardware: string;
  packaging: string;
  cad: string;
  failure: string;
  rush: string;
  pricingMode: PricingMethod;
  profit: string;
  minimum: string;
  discount: string;
  paymentFee: string;
  tax: string;
  infill: string;
};

type TextFields<T> = { [Key in keyof T]: T[Key] extends number ? string : T[Key] };
type PrinterForm = TextFields<PrinterProfile>;

const D = DEFAULT_COST_INPUTS;
const DEFAULTS: CostSettings = {
  filamentPrice: String(D.filamentPricePerKg),
  waste: String(D.materialReservePercent),
  quantity: String(D.quantity),
  setupMinutes: String(D.setupMinutesPerOrder),
  laborRate: String(D.laborRatePerHour),
  finishingMinutes: String(D.finishingMinutesPerUnit),
  hardware: String(D.hardwarePerUnit),
  packaging: String(D.packagingPerUnit),
  cad: String(D.cadFeePerOrder),
  failure: String(D.failureReservePercent),
  rush: String(D.rushFeePerOrder),
  pricingMode: D.pricing,
  profit: String(D.profitPercent),
  minimum: String(D.minimumOrderPrice),
  discount: String(D.discountPercent),
  paymentFee: String(D.paymentFeePercent),
  tax: String(D.taxPercent),
  infill: "15",
};

// What one unit of each choice is in millimeters.
const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 } as const;
type Unit = keyof typeof UNITS;

// An uploaded file measured in its own units; units and scale turn it into millimeters.
type Upload = {
  name: string;
  positions: Float32Array;
  measure: ReturnType<typeof measureMesh>;
  repaired: boolean;
  unit: Unit;
  scale: string;
};

// glTF is in meters; most other files are in millimeters. A file that's tiny in its own
// units was most likely made in meters.
function guessUnit(extension: string, size: [number, number, number]): Unit {
  const longest = Math.max(...size);
  if (extension === "glb" || extension === "gltf") return longest < 5 ? "m" : "mm";
  return longest < 1 ? "m" : "mm";
}

function printerForm(printer: PrinterProfile): PrinterForm {
  return {
    ...printer,
    purchasePrice: String(printer.purchasePrice),
    lifespanHours: String(printer.lifespanHours),
    maintenancePerHour: String(printer.maintenancePerHour),
    averagePowerKw: String(printer.averagePowerKw),
    electricityRate: String(printer.electricityRate),
    overheadPerHour: String(printer.overheadPerHour),
    manualWearPerHour: String(printer.manualWearPerHour),
  };
}

const A1_FORM = printerForm(BAMBU_A1);

// Blank optional fields fall back to their defaults; blank required ones stay invalid.
function parse(text: string, fallback?: number) {
  if (text.trim() === "") return fallback ?? Number.NaN;
  return Number(text);
}

function printerProfile(form: PrinterForm): PrinterProfile {
  return {
    ...form,
    purchasePrice: parse(form.purchasePrice, BAMBU_A1.purchasePrice),
    lifespanHours: parse(form.lifespanHours, BAMBU_A1.lifespanHours),
    maintenancePerHour: parse(form.maintenancePerHour, 0),
    averagePowerKw: parse(form.averagePowerKw, BAMBU_A1.averagePowerKw),
    electricityRate: parse(form.electricityRate, BAMBU_A1.electricityRate),
    overheadPerHour: parse(form.overheadPerHour, 0),
    manualWearPerHour: parse(form.manualWearPerHour, 0),
  };
}

function costInputs(settings: CostSettings, grams: number, hours: number, printer: PrinterForm): CostInputs {
  return {
    gramsPerUnit: grams,
    hoursPerUnit: hours,
    quantity: parse(settings.quantity),
    filamentPricePerKg: parse(settings.filamentPrice, D.filamentPricePerKg),
    materialReservePercent: parse(settings.waste, 0),
    hardwarePerUnit: parse(settings.hardware, 0),
    packagingPerUnit: parse(settings.packaging, 0),
    setupMinutesPerOrder: parse(settings.setupMinutes, 0),
    laborRatePerHour: parse(settings.laborRate, D.laborRatePerHour),
    finishingMinutesPerUnit: parse(settings.finishingMinutes, 0),
    cadFeePerOrder: parse(settings.cad, 0),
    failureReservePercent: parse(settings.failure, 0),
    rushFeePerOrder: parse(settings.rush, 0),
    pricing: settings.pricingMode,
    profitPercent: parse(settings.profit, 0),
    minimumOrderPrice: parse(settings.minimum, 0),
    discountPercent: parse(settings.discount, 0),
    paymentFeePercent: parse(settings.paymentFee, 0),
    taxPercent: parse(settings.tax, 0),
    printer: printerProfile(printer),
  };
}

const STORAGE_KEY = "depth-cost-calculator-v1";

type Saved = { settings: CostSettings; printers: PrinterForm[]; printerId: string };

function loadSaved(): Saved {
  const fallback: Saved = { settings: DEFAULTS, printers: [A1_FORM], printerId: A1_FORM.id };
  if (typeof window === "undefined") return fallback;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    if (!saved || !Array.isArray(saved.printers) || !saved.printers.length) return fallback;
    const printers = saved.printers.map((printer) => ({ ...A1_FORM, ...printer }));
    const printerId = printers.some((printer) => printer.id === saved.printerId) ? saved.printerId! : printers[0].id;
    return { settings: { ...DEFAULTS, ...saved.settings }, printers, printerId };
  } catch {
    return fallback;
  }
}

function amount(value: number) {
  return Number(value.toFixed(2)).toLocaleString("en-PH");
}

// One plain-language line per quotation row showing how its amount was worked out.
function lineDetails(inputs: CostInputs, quote: CostBreakdown) {
  const { printer, quantity } = inputs;
  const peso = formatPeso;
  const units = quantity > 1 ? ` × ${quantity} pcs` : "";
  const hours = `${amount(quote.machineHours)} h of printing`;
  const reserve = inputs.materialReservePercent ? ` + ${amount(inputs.materialReservePercent)}% extra` : "";
  const wearSource =
    printer.wearMode === "auto"
      ? ` (${peso(printer.purchasePrice)} printer ÷ ${amount(printer.lifespanHours)} h + ${peso(printer.maintenancePerHour)}/h upkeep)`
      : "";
  const profit = inputs.profitPercent;
  return {
    material: `${amount(inputs.gramsPerUnit)} g of filament at ${peso(inputs.filamentPricePerKg)}/kg${reserve}${units}`,
    electricity: `${amount(printer.averagePowerKw)} kW × ${hours} × ${peso(printer.electricityRate)}/kWh`,
    wear: `${hours} × ${peso(quote.wearRate)}/h for nozzle, plate and printer wear${wearSource}`,
    overhead: `${hours} × ${peso(printer.overheadPerHour)}/h for rent, internet and other shop costs`,
    setup: `${amount(inputs.setupMinutesPerOrder)} min at ${peso(inputs.laborRatePerHour)}/h to slice, start and clear the print · once per order`,
    finish: inputs.finishingMinutesPerUnit
      ? `${amount(inputs.finishingMinutesPerUnit)} min at ${peso(inputs.laborRatePerHour)}/h to clean up each piece${units}`
      : "No sanding, support removal or assembly time",
    extras:
      inputs.hardwarePerUnit || inputs.packagingPerUnit
        ? `${peso(inputs.hardwarePerUnit)} hardware + ${peso(inputs.packagingPerUnit)} packaging per piece${units}`
        : "No keyrings, magnets or packaging added",
    cad: inputs.cadFeePerOrder ? "One-time design or modeling fee for this order" : "No design fee",
    failure: `${amount(inputs.failureReservePercent)}% of ${peso(quote.eligible)} set aside in case a print fails and must be redone`,
    cost: "Everything above: what this order costs you to make",
    profitAmount:
      inputs.pricing === "margin"
        ? `${peso(quote.cost)} ÷ (1 − ${amount(profit)}%) so profit is ${amount(profit)}% of the price`
        : `${amount(profit)}% of ${peso(quote.cost)} production cost`,
    beforeDiscount: "Production cost + profit",
    discount: inputs.discountPercent ? `${amount(inputs.discountPercent)}% off ${peso(quote.beforeDiscount)}` : "No discount",
    rush: inputs.rushFeePerOrder ? "Added for a faster turnaround" : "No rush fee",
    minimumAdjustment:
      quote.minimumAdjustment > 0
        ? `Brings ${peso(quote.afterRush)} up to the ${peso(inputs.minimumOrderPrice)} minimum order`
        : `Price is already above the ${peso(inputs.minimumOrderPrice)} minimum order`,
    paymentFee: inputs.paymentFeePercent
      ? `Covers the ${amount(inputs.paymentFeePercent)}% GCash / card fee so you still receive ${peso(quote.base)}`
      : "No payment fee",
    tax: inputs.taxPercent ? `${amount(inputs.taxPercent)}% of ${peso(quote.beforeTax)}` : "No tax added",
  };
}

const ESTIMATED_GRAMS_PER_HOUR = 15;

// The model's parts as one list of triangle corners, in millimeters.
function modelTriangles(geometries: BufferGeometry[]) {
  const lists = geometries.map((geometry) => {
    const positions = geometry.getAttribute("position");
    const indices = geometry.getIndex();
    const count = indices ? indices.count : positions.count;
    const flat = new Float32Array(count * 3);
    for (let corner = 0; corner < count; corner += 1) {
      const at = indices ? indices.getX(corner) : corner;
      flat[corner * 3] = positions.getX(at);
      flat[corner * 3 + 1] = positions.getY(at);
      flat[corner * 3 + 2] = positions.getZ(at);
    }
    return flat;
  });
  const all = new Float32Array(lists.reduce((sum, list) => sum + list.length, 0));
  let at = 0;
  for (const list of lists) {
    all.set(list, at);
    at += list.length;
  }
  return all;
}

function sizeText(size: [number, number, number]) {
  return `${size.map((side) => side.toFixed(1)).join(" × ")} mm`;
}

export function CostEstimate({ model, modelName }: { model: KeychainModel | null; modelName: string }) {
  const [open, setOpen] = useState(false);
  const [saved] = useState(loadSaved);
  const [settings, setSettings] = useState<CostSettings>(saved.settings);
  const [printers, setPrinters] = useState<PrinterForm[]>(saved.printers);
  const [printerId, setPrinterId] = useState(saved.printerId);
  const [weightOverride, setWeightOverride] = useState<{ source: string; grams: string } | null>(null);
  const [hoursOverride, setHoursOverride] = useState<string | null>(null);
  const [included, setIncluded] = useState<Included>(ALL_INCLUDED);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const printer = printers.find((entry) => entry.id === printerId) ?? printers[0];

  const modelMeasure = useMemo(() => (model ? measureMesh(modelTriangles([model.base, model.text])) : null), [model]);
  const uploadPositions = upload?.positions;
  const previewParts = useMemo<PreviewPart[]>(() => {
    if (uploadPositions) return [{ positions: uploadPositions, color: "#8b78f2" }];
    if (!model) return [];
    return [
      { positions: modelTriangles([model.base]), color: "#8b78f2" },
      { positions: modelTriangles([model.text]), color: "#f4f4f5" },
    ];
  }, [model, uploadPositions]);
  // The uploaded file in millimeters, at the scale picked.
  const uploadFactor = upload ? UNITS[upload.unit] * (parse(upload.scale, 100) / 100) : 1;
  const measure = upload
    ? {
        volume: upload.measure.volume * uploadFactor ** 3,
        area: upload.measure.area * uploadFactor ** 2,
        size: upload.measure.size.map((side) => side * uploadFactor) as [number, number, number],
      }
    : modelMeasure;
  const infill = parse(settings.infill, 15);
  const infillProblem = !Number.isFinite(infill) || infill < 0 || infill > 100 ? "Infill must be between 0% and 100%." : null;
  const scaleProblem = upload && !(uploadFactor > 0) ? "Scale must be more than 0%." : null;
  const estimatedGrams = measure && !infillProblem && !scaleProblem ? estimateGrams(measure.volume, measure.area, infill) : 0;
  // Typed grams stay until the thing being priced or its size changes.
  const source = upload ? `${upload.name}:${uploadFactor}` : `model:${measure?.volume ?? 0}`;
  const gramsText = weightOverride?.source === source ? weightOverride.grams : estimatedGrams.toFixed(1);
  const estimatedHours = estimatedGrams / ESTIMATED_GRAMS_PER_HOUR;
  const hoursText = hoursOverride ?? estimatedHours.toFixed(2);
  const inputs = costInputs(settings, parse(gramsText), parse(hoursText), printer);
  const problems = [infillProblem, scaleProblem, ...costProblems(inputs)].filter((problem): problem is string => !!problem);
  const estimate = problems.length ? null : calculateCost(inputs, included);
  const autoWear = wearPerHour({ ...inputs.printer, wearMode: "auto" });
  const details = estimate ? lineDetails(inputs, estimate) : null;
  const line = (key: CostLine, label: string, sign = "") => ({
    label,
    detail: details?.[key],
    value: estimate ? `${sign}${formatPeso(estimate[key])}` : "—",
    included: included[key],
    onToggle: () => setIncluded((current) => ({ ...current, [key]: !current[key] })),
  });
  const sections: { step: string; title: string; note: string; rows: Row[] }[] = [
    {
      step: "1",
      title: "Cost to make",
      note: "Material, machine time and labor",
      rows: [
        line("material", "Material"),
        line("electricity", "Electricity"),
        line("wear", "Printer wear and maintenance"),
        line("overhead", "Shop overhead"),
        line("setup", "Setup labor"),
        line("finish", "Finishing labor"),
        line("extras", "Hardware + packaging"),
        line("cad", "CAD / design"),
        line("failure", "Failure reserve"),
        {
          label: "Total production cost",
          detail: details?.cost,
          value: estimate ? formatPeso(estimate.cost) : "—",
          emphasized: true,
        },
      ],
    },
    {
      step: "2",
      title: "Selling price",
      note: settings.pricingMode === "margin" ? "Target gross margin" : "Markup on cost",
      rows: [
        {
          label: `Profit (${settings.pricingMode === "margin" ? "margin" : "markup"} ${inputs.profitPercent}%)`,
          detail: details?.profitAmount,
          value: estimate ? `+${formatPeso(estimate.profitAmount)}` : "—",
        },
        {
          label: "Price before discount",
          detail: details?.beforeDiscount,
          value: estimate ? formatPeso(estimate.beforeDiscount) : "—",
          emphasized: true,
        },
      ],
    },
    {
      step: "3",
      title: "Adjustments",
      note: "Applied in this order",
      rows: [
        line("discount", "Discount", "−"),
        line("rush", "Rush fee", "+"),
        line("minimumAdjustment", "Minimum order top-up", "+"),
        line("paymentFee", "Payment fee allowance", "+"),
        line("tax", "Tax", "+"),
      ],
    },
  ];
  const totalLabel = `Final order price · ${estimate?.quantity ?? "—"} ${estimate?.quantity === 1 ? "piece" : "pieces"}`;
  const shown = (value: number, unit: string) => (Number.isFinite(value) ? `${amount(value)} ${unit}` : "—");
  const facts: [string, string][] = [
    ["Size", measure ? sizeText(measure.size) : "—"],
    ["Filament / piece", shown(inputs.gramsPerUnit, "g")],
    ["Print time / piece", shown(inputs.hoursPerUnit, "h")],
    ["Quantity", Number.isFinite(inputs.quantity) ? `${inputs.quantity} ${inputs.quantity === 1 ? "piece" : "pieces"}` : "—"],
  ];
  const previewRef = useRef<PreviewHandle>(null);
  const [exporting, setExporting] = useState<"quote" | "card" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportImage(kind: "quote" | "card") {
    if (!estimate) return;
    setExporting(kind);
    setExportError(null);
    try {
      const name = upload?.name ?? modelName;
      const card = () =>
        priceCardImage({
          picture: previewRef.current?.snapshot(CARD_PICTURE.width, CARD_PICTURE.height) ?? null,
          price: formatPeso(estimate.finalOrder),
          perPiece: estimate.quantity > 1 ? `${formatPeso(estimate.perUnit)} each · ${estimate.quantity} pieces` : null,
          name,
          size: measure ? sizeText(measure.size) : "",
          facts,
        });
      const blob = kind === "card" ? await card() : await quoteImage({
        title: "Print quotation",
        subtitle: `${name} · ${printer.name || "Printer"} · Philippine pesos`,
        date: new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }),
        picture: previewRef.current?.snapshot(QUOTE_PICTURE.width, QUOTE_PICTURE.height) ?? null,
        facts,
        summary: [
          ["Cost to make", formatPeso(estimate.cost)],
          ["Your profit", formatPeso(estimate.netProfit)],
          ["Customer pays", formatPeso(estimate.finalOrder)],
        ],
        sections: sections.map(({ step, title, note, rows }) => ({
          step,
          title,
          note,
          rows: rows.map((row) => ({
            label: row.label,
            detail: row.detail,
            value: row.value,
            leftOut: row.included === false,
            emphasized: row.emphasized,
          })),
        })),
        total: [totalLabel, formatPeso(estimate.finalOrder)],
        notes: [
          `${estimate.quantity > 1 ? `${formatPeso(estimate.perUnit)} per piece · ` : ""}${amount(estimate.machineHours)} h total print time.`,
          "Filament and print time are estimates; the final slicer values may change the price slightly.",
        ],
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name.replace(/[^\w\- ]+/g, "").trim() || "model"} ${kind === "card" ? "price" : "quotation"}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "Could not save the quotation image.");
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, printers, printerId } satisfies Saved));
    } catch {
      // Storage can be full or blocked; the calculator still works for this visit.
    }
  }, [settings, printers, printerId]);

  function patch<Key extends keyof CostSettings>(key: Key, value: CostSettings[Key]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const read = await readModelFile(file);
      const measure = measureMesh(read.positions);
      if (!(measure.volume > 0)) throw new Error("That file has no closed solid to measure. Try exporting it as a solid.");
      setUpload({ name: read.name, positions: read.positions, measure, repaired: read.repair !== null, unit: guessUnit(read.extension, measure.size), scale: "100" });
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "Could not read that file.");
    } finally {
      setUploading(false);
    }
  }

  function patchPrinter<Key extends keyof PrinterForm>(key: Key, value: PrinterForm[Key]) {
    setPrinters((current) => current.map((entry) => (entry.id === printer.id ? { ...entry, [key]: value } : entry)));
  }

  function addPrinter() {
    const id = `printer-${Date.now().toString(36)}`;
    setPrinters((current) => [...current, { ...printer, id, name: `${printer.name} copy` }]);
    setPrinterId(id);
  }

  function removePrinter() {
    if (printers.length < 2 || !window.confirm(`Remove the “${printer.name}” printer profile?`)) return;
    const rest = printers.filter((entry) => entry.id !== printer.id);
    setPrinters(rest);
    setPrinterId(rest[0].id);
  }

  function resetPrinter() {
    if (!window.confirm(`Reset “${printer.name}” to the Bambu Lab A1 defaults? Your values for this printer will be replaced.`)) return;
    setPrinters((current) =>
      current.map((entry) => (entry.id === printer.id ? { ...A1_FORM, id: entry.id, name: entry.name } : entry)),
    );
  }

  function saveAutoAsManual() {
    const rate = autoWear.toFixed(2);
    if (!window.confirm(`Replace your manual rate of ₱${printer.manualWearPerHour}/h with ₱${rate}/h?`)) return;
    patchPrinter("manualWearPerHour", rate);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!model}
        className="inline-flex h-10 items-center rounded-lg border border-[#e1e3e8] bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        Estimated cost
      </button>
      {open && model ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-zinc-950/50 p-4"
          onClick={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cost-estimate-title"
            className="my-auto max-h-[min(90vh,800px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="cost-estimate-title" className="text-lg font-semibold text-zinc-900">
                  Print cost estimate
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {upload?.name ?? modelName} · {printer.name || "Printer"} · Philippine pesos
                </p>
              </div>
              <button
                type="button"
                aria-label="Close estimated cost"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-200 text-xl text-zinc-500 hover:bg-zinc-50"
              >
                ×
              </button>
            </div>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">What to price</h3>
              <input
                id="cost-upload"
                type="file"
                accept={MODEL_FORMATS}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadFile(file);
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-zinc-900" title={upload?.name ?? modelName}>
                    {upload ? `Uploaded file: ${upload.name}` : `This model: ${modelName}`}
                  </p>
                  <p className="text-xs text-zinc-500 tabular-nums">
                    {measure ? `${sizeText(measure.size)} · ${(measure.volume / 1000).toFixed(2)} cm³ solid` : "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {upload ? (
                    <button
                      type="button"
                      onClick={() => setUpload(null)}
                      className="text-xs font-medium text-zinc-500 hover:underline"
                    >
                      Use this model instead
                    </button>
                  ) : null}
                  <label
                    htmlFor="cost-upload"
                    className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    {uploading ? "Reading and repairing…" : upload ? "Upload another" : "Upload 3D file"}
                  </label>
                </div>
              </div>
              {upload ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <label className="block text-xs text-zinc-600">
                    File units
                    <select
                      value={upload.unit}
                      onChange={(event) => setUpload({ ...upload, unit: event.target.value as Unit })}
                      className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900"
                    >
                      <option value="mm">Millimeters</option>
                      <option value="cm">Centimeters</option>
                      <option value="m">Meters</option>
                      <option value="in">Inches</option>
                    </select>
                  </label>
                  <CostInput
                    id="cost-upload-scale"
                    label="Scale (%)"
                    value={upload.scale}
                    onChange={(scale) => setUpload({ ...upload, scale })}
                    step="1"
                    placeholder="100"
                  />
                </div>
              ) : null}
              {uploadError ? (
                <p role="alert" className="mt-2 text-xs text-red-600">
                  {uploadError}
                </p>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {upload
                  ? `Check the size above matches your print; change the units or scale if it doesn't.${upload.repaired ? " The file had gaps, so it was repaired before measuring." : ""}`
                  : "Upload any STL, OBJ, GLB, glTF, or 3MF file to price it with the settings below. The model on this page isn't changed."}
              </p>
            </section>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Print job inputs</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CostInput
                  id="cost-weight"
                  label="Filament usage / unit (g)"
                  value={gramsText}
                  onChange={(value) => setWeightOverride({ source, grams: value })}
                  step="0.1"
                  max="100000"
                />
                <CostInput
                  id="cost-hours"
                  label="Print time / unit (hours)"
                  value={hoursText}
                  onChange={setHoursOverride}
                  step="0.1"
                />
                <CostInput id="cost-qty" label="Quantity" value={settings.quantity} onChange={(value) => patch("quantity", value)} step="1" min="1" />
                <CostInput id="cost-spool" label="Filament price / kg (₱)" value={settings.filamentPrice} onChange={(value) => patch("filamentPrice", value)} placeholder={DEFAULTS.filamentPrice} />
                <CostInput id="cost-waste" label="Extra material reserve (%)" value={settings.waste} onChange={(value) => patch("waste", value)} max="100" placeholder="0" />
                <CostInput id="cost-hardware" label="Hardware / unit (₱)" value={settings.hardware} onChange={(value) => patch("hardware", value)} placeholder="0" />
                <CostInput id="cost-packaging" label="Packaging / unit (₱)" value={settings.packaging} onChange={(value) => patch("packaging", value)} placeholder="0" />
                <CostInput id="cost-infill" label="Infill for estimate (%)" value={settings.infill} onChange={(value) => patch("infill", value)} step="1" max="100" placeholder="15" />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs leading-5 text-zinc-500">
                  {hoursOverride === null
                    ? `Automatic estimate from model volume at ${ESTIMATED_GRAMS_PER_HOUR} g/hour. Actual slicer time may vary.`
                    : "Custom print time is active and will not change with the model."}
                </p>
                {hoursOverride !== null ? (
                  <button
                    type="button"
                    onClick={() => setHoursOverride(null)}
                    className="shrink-0 text-xs font-medium text-[#2f80ed] hover:underline"
                  >
                    Use automatic estimate
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Filament usage is estimated as PLA (1.24 g/cm³): solid 0.84 mm walls and skins, with the infill above
                inside. For the most accurate material cost, use the total filament grams from Bambu Studio,
                including supports, purge, and prime tower.
              </p>
            </section>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Printer and machine costs</h3>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="block text-xs text-zinc-600">
                  Printer profile
                  <select
                    value={printer.id}
                    onChange={(event) => setPrinterId(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900"
                  >
                    {printers.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name || "Unnamed printer"}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="cost-printer-name" className="block text-xs text-zinc-600">
                  Printer name
                  <input
                    id="cost-printer-name"
                    value={printer.name}
                    onChange={(event) => patchPrinter("name", event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900"
                  />
                </label>
                <div className="col-span-2 flex flex-wrap items-end gap-3 text-xs font-medium sm:col-span-1">
                  <button type="button" onClick={addPrinter} className="h-9 text-[#2f80ed] hover:underline">
                    Add printer
                  </button>
                  <button type="button" onClick={resetPrinter} className="h-9 text-zinc-500 hover:underline">
                    A1 defaults
                  </button>
                  {printers.length > 1 ? (
                    <button type="button" onClick={removePrinter} className="h-9 text-red-600 hover:underline">
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CostInput id="cost-electricity" label="Electricity rate (₱/kWh)" value={printer.electricityRate} onChange={(value) => patchPrinter("electricityRate", value)} placeholder={A1_FORM.electricityRate} />
                <CostInput id="cost-power" label="Average power (kW)" value={printer.averagePowerKw} onChange={(value) => patchPrinter("averagePowerKw", value)} step="0.01" placeholder={A1_FORM.averagePowerKw} />
                <CostInput id="cost-overhead" label="Other machine overhead (₱/h)" value={printer.overheadPerHour} onChange={(value) => patchPrinter("overheadPerHour", value)} placeholder="0" />
                <label className="block text-xs text-zinc-600">
                  Maintenance + depreciation
                  <select
                    value={printer.wearMode}
                    onChange={(event) => patchPrinter("wearMode", event.target.value as PrinterForm["wearMode"])}
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900"
                  >
                    <option value="manual">Manual rate</option>
                    <option value="auto">From printer price</option>
                  </select>
                </label>
                {printer.wearMode === "manual" ? (
                  <CostInput id="cost-wear" label="Maintenance + depreciation (₱/h)" value={printer.manualWearPerHour} onChange={(value) => patchPrinter("manualWearPerHour", value)} placeholder="0" />
                ) : (
                  <>
                    <CostInput id="cost-printer-price" label="Printer price (₱)" value={printer.purchasePrice} onChange={(value) => patchPrinter("purchasePrice", value)} step="1" placeholder={A1_FORM.purchasePrice} />
                    <CostInput id="cost-lifespan" label="Expected lifespan (print hours)" value={printer.lifespanHours} onChange={(value) => patchPrinter("lifespanHours", value)} step="100" min="1" placeholder={A1_FORM.lifespanHours} />
                    <CostInput id="cost-maintenance" label="Maintenance budget (₱/h)" value={printer.maintenancePerHour} onChange={(value) => patchPrinter("maintenancePerHour", value)} placeholder="0" />
                  </>
                )}
              </div>
              {printer.wearMode === "auto" ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-zinc-500">
                  <p>
                    {Number.isFinite(autoWear) && autoWear >= 0
                      ? `Price ÷ lifespan + maintenance = ${formatPeso(autoWear)}/h. Your manual rate (₱${printer.manualWearPerHour || "0"}/h) is kept.`
                      : "Enter a printer price and a lifespan above 0 hours."}
                  </p>
                  {Number.isFinite(autoWear) && autoWear >= 0 ? (
                    <button type="button" onClick={saveAutoAsManual} className="shrink-0 font-medium text-[#2f80ed] hover:underline">
                      Save as manual rate
                    </button>
                  ) : null}
                </div>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Electricity defaults to ₱14.74/kWh. Meralco&apos;s rate changes every billing month; use the
                rate on your latest bill. Average power is the A1&apos;s typical draw while printing, not its peak.
              </p>
            </section>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Labor and service costs</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CostInput id="cost-setup" label="Setup / cleanup per order (min)" value={settings.setupMinutes} onChange={(value) => patch("setupMinutes", value)} step="1" placeholder="0" />
                <CostInput id="cost-labor" label="Labor rate (₱/hour)" value={settings.laborRate} onChange={(value) => patch("laborRate", value)} placeholder={DEFAULTS.laborRate} />
                <CostInput id="cost-finish" label="Finishing / unit (minutes)" value={settings.finishingMinutes} onChange={(value) => patch("finishingMinutes", value)} step="1" placeholder="0" />
                <CostInput id="cost-cad" label="CAD / design fee (₱/order)" value={settings.cad} onChange={(value) => patch("cad", value)} placeholder="0" />
                <CostInput id="cost-failure" label="Failure / reprint reserve (%)" value={settings.failure} onChange={(value) => patch("failure", value)} max="100" placeholder="0" />
                <CostInput id="cost-rush" label="Rush order fee (₱/order)" value={settings.rush} onChange={(value) => patch("rush", value)} placeholder="0" />
              </div>
            </section>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Selling price inputs</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="block text-xs text-zinc-600">
                  Pricing method
                  <select
                    value={settings.pricingMode}
                    onChange={(event) => patch("pricingMode", event.target.value as PricingMethod)}
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900"
                  >
                    <option value="markup">Markup on cost</option>
                    <option value="margin">Target gross margin</option>
                  </select>
                </label>
                <CostInput
                  id="cost-profit"
                  label={settings.pricingMode === "margin" ? "Gross margin (%)" : "Markup (%)"}
                  value={settings.profit}
                  onChange={(value) => patch("profit", value)}
                  max={settings.pricingMode === "margin" ? "99.9" : undefined}
                  placeholder="0"
                />
                <CostInput id="cost-minimum" label="Minimum order price (₱)" value={settings.minimum} onChange={(value) => patch("minimum", value)} placeholder="0" />
                <CostInput id="cost-discount" label="Quantity discount (%)" value={settings.discount} onChange={(value) => patch("discount", value)} max="100" placeholder="0" />
                <CostInput id="cost-fee" label="Payment fee (%)" value={settings.paymentFee} onChange={(value) => patch("paymentFee", value)} step="0.1" max="99.9" placeholder="0" />
                <CostInput id="cost-tax" label="Tax (%)" value={settings.tax} onChange={(value) => patch("tax", value)} step="0.1" max="100" placeholder="0" />
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Markup adds a percentage of cost (60% on ₱100 → ₱160). Margin sets profit as a share of the price
                (40% → ₱100 ÷ 0.6 = ₱166.67).
              </p>
            </section>

            {problems.length ? (
              <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {problems.map((problem) => (
                  <p key={problem}>{problem}</p>
                ))}
              </div>
            ) : null}
            <section className="rounded-xl bg-[#1e1e24] p-4 text-white">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold">Quotation breakdown</h3>
                <div className="flex items-center gap-3">
                  {Object.values(included).some((on) => !on) ? (
                    <button
                      type="button"
                      onClick={() => setIncluded(ALL_INCLUDED)}
                      className="text-xs font-medium text-sky-300 hover:underline"
                    >
                      Include all
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void exportImage("card")}
                    disabled={!estimate || !!exporting}
                    title="Save the 3D view with its price and details as a PNG"
                    className="h-8 rounded-md bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50"
                  >
                    {exporting === "card" ? "Saving…" : "Export price card"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportImage("quote")}
                    disabled={!estimate || !!exporting}
                    title="Save the full quotation with every line as a PNG"
                    className="h-8 rounded-md bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50"
                  >
                    {exporting === "quote" ? "Saving…" : "Export full quotation"}
                  </button>
                </div>
              </div>
              {exportError ? (
                <p role="alert" className="mb-2 text-xs text-red-300">
                  {exportError}
                </p>
              ) : null}
              <div className="mb-3">
                <ModelPreview ref={previewRef} parts={previewParts} mmPerUnit={upload ? uploadFactor : 1}>
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Customer pays</p>
                      <p className="text-2xl font-semibold text-emerald-400 tabular-nums">
                        {estimate ? formatPeso(estimate.finalOrder) : "—"}
                      </p>
                      {estimate && estimate.quantity > 1 ? (
                        <p className="text-xs text-zinc-300 tabular-nums">
                          {formatPeso(estimate.perUnit)} each · {estimate.quantity} pieces
                        </p>
                      ) : null}
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="truncate text-xs font-medium text-zinc-200">{upload?.name ?? modelName}</p>
                      <p className="text-[11px] text-zinc-400 tabular-nums">{measure ? sizeText(measure.size) : ""}</p>
                    </div>
                  </div>
                  <p className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-zinc-500">Drag to turn</p>
                </ModelPreview>
              </div>
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {facts.map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-white/5 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
                    <p className="mt-0.5 truncate text-sm font-medium tabular-nums text-white" title={value}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              {estimate ? (
                <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                  <Summary label="Cost to make" value={formatPeso(estimate.cost)} />
                  <Summary label="Your profit" value={formatPeso(estimate.netProfit)} />
                  <Summary label="Customer pays" value={formatPeso(estimate.finalOrder)} highlight />
                </div>
              ) : null}
              <p className="mb-3 text-xs text-zinc-400">
                Each line shows how it was worked out. Uncheck a line to leave it out of the price.
              </p>
              <div className="space-y-2.5 text-sm">
                {sections.map((section) => (
                  <Fragment key={section.step}>
                    <StepHeading step={section.step} title={section.title} note={section.note} />
                    {section.rows.map((row) => (
                      <CostRow key={row.label} {...row} />
                    ))}
                  </Fragment>
                ))}
                <div className="flex items-center justify-between gap-4 border-t border-zinc-600 pt-3 text-base font-semibold">
                  <span>{totalLabel}</span>
                  <span className="text-right text-xl text-emerald-400">{estimate ? formatPeso(estimate.finalOrder) : "—"}</span>
                </div>
                <p className="text-xs text-zinc-300">
                  {estimate && estimate.quantity > 1 ? `${formatPeso(estimate.perUnit)} per piece · ` : ""}
                  {estimate ? `${amount(estimate.machineHours)} h total print time` : "—"}
                </p>
              </div>
            </section>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 h-10 w-full rounded-lg bg-[#2f80ed] text-sm font-medium text-white hover:bg-[#1f6fd6]"
            >
              Done
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CostInput({
  id,
  label,
  value,
  onChange,
  step = "0.01",
  min = "0",
  max,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  return (
    <label htmlFor={id} className="block text-xs text-zinc-600">
      {label}
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm tabular-nums text-zinc-900"
      />
    </label>
  );
}

function Summary({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${highlight ? "text-emerald-400" : "text-white"}`}>{value}</p>
    </div>
  );
}

function StepHeading({ step, title, note }: { step: string; title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2 first:pt-0">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-[11px] font-semibold text-emerald-300">
        {step}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">{title}</span>
      <span className="text-xs text-zinc-500">{note}</span>
    </div>
  );
}

type Row = {
  label: string;
  detail?: string;
  value: string;
  emphasized?: boolean;
  included?: boolean;
  onToggle?: () => void;
};

function CostRow({ label, detail, value, emphasized = false, included, onToggle }: Row) {
  const excluded = included === false;
  const text = (
    <span className="min-w-0">
      <span className={excluded ? "text-zinc-500 line-through" : "text-zinc-200"}>{label}</span>
      {detail ? (
        <span className={`block text-xs font-normal leading-5 ${excluded ? "text-zinc-600" : "text-zinc-400"}`}>
          {excluded ? "Left out of the price" : detail}
        </span>
      ) : null}
    </span>
  );
  return (
    <div className={`flex items-start justify-between gap-4 ${emphasized ? "border-t border-zinc-600 pt-2 font-semibold" : ""}`}>
      {onToggle ? (
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={included}
            onChange={onToggle}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-400"
          />
          {text}
        </label>
      ) : (
        <span className={emphasized ? "" : "pl-6"}>{text}</span>
      )}
      <span
        className={`shrink-0 text-right font-medium tabular-nums ${excluded ? "text-zinc-500 line-through" : "text-white"}`}
      >
        {value}
      </span>
    </div>
  );
}
