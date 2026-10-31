"use client";

import { useEffect, useMemo, useState } from "react";
import type { BufferGeometry } from "three";
import type { KeychainModel } from "@/lib/geometry";
import {
  ALL_INCLUDED,
  BAMBU_A1,
  calculateCost,
  costProblems,
  DEFAULT_COST_INPUTS,
  formatPeso,
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
};

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

const PLA_DENSITY = 1.24;
const ESTIMATED_GRAMS_PER_HOUR = 15;

function geometryVolume(geometry: BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const indices = geometry.getIndex();
  let signedVolume = 0;
  const triangleCount = indices ? indices.count / 3 : positions.count / 3;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = indices ? indices.getX(triangle * 3) : triangle * 3;
    const b = indices ? indices.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = indices ? indices.getX(triangle * 3 + 2) : triangle * 3 + 2;
    const ax = positions.getX(a);
    const ay = positions.getY(a);
    const az = positions.getZ(a);
    const bx = positions.getX(b);
    const by = positions.getY(b);
    const bz = positions.getZ(b);
    const cx = positions.getX(c);
    const cy = positions.getY(c);
    const cz = positions.getZ(c);
    signedVolume +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
  }

  const volume = Math.abs(signedVolume / 6);
  if (!Number.isFinite(volume)) throw new Error("Could not estimate the model volume.");
  return volume;
}

export function CostEstimate({ model, modelName }: { model: KeychainModel | null; modelName: string }) {
  const [open, setOpen] = useState(false);
  const [saved] = useState(loadSaved);
  const [settings, setSettings] = useState<CostSettings>(saved.settings);
  const [printers, setPrinters] = useState<PrinterForm[]>(saved.printers);
  const [printerId, setPrinterId] = useState(saved.printerId);
  const [weightOverride, setWeightOverride] = useState<{ volume: number; grams: string } | null>(null);
  const [hoursOverride, setHoursOverride] = useState<string | null>(null);
  const [included, setIncluded] = useState<Included>(ALL_INCLUDED);
  const printer = printers.find((entry) => entry.id === printerId) ?? printers[0];

  const volume = useMemo(
    () => (model ? geometryVolume(model.base) + geometryVolume(model.text) : 0),
    [model],
  );
  const estimatedGrams = (volume / 1000) * PLA_DENSITY;
  const gramsText = weightOverride?.volume === volume ? weightOverride.grams : estimatedGrams.toFixed(1);
  const estimatedHours = estimatedGrams / ESTIMATED_GRAMS_PER_HOUR;
  const hoursText = hoursOverride ?? estimatedHours.toFixed(2);
  const inputs = costInputs(settings, parse(gramsText), parse(hoursText), printer);
  const problems = costProblems(inputs);
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
                <p className="mt-1 text-sm text-zinc-500">{modelName} · {printer.name || "Printer"} · Philippine pesos</p>
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
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Print job inputs</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CostInput
                  id="cost-weight"
                  label="Filament usage / unit (g)"
                  value={gramsText}
                  onChange={(value) => setWeightOverride({ volume, grams: value })}
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
                Filament usage starts from solid mesh volume at 1.24 g/cm³. For the most accurate material cost,
                use the total filament grams from Bambu Studio, including supports, purge, and prime tower.
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
                {Object.values(included).some((on) => !on) ? (
                  <button
                    type="button"
                    onClick={() => setIncluded(ALL_INCLUDED)}
                    className="text-xs font-medium text-sky-300 hover:underline"
                  >
                    Include all
                  </button>
                ) : null}
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
                <StepHeading step="1" title="Cost to make" note="Material, machine time and labor" />
                <CostRow {...line("material", "Material")} />
                <CostRow {...line("electricity", "Electricity")} />
                <CostRow {...line("wear", "Printer wear and maintenance")} />
                <CostRow {...line("overhead", "Shop overhead")} />
                <CostRow {...line("setup", "Setup labor")} />
                <CostRow {...line("finish", "Finishing labor")} />
                <CostRow {...line("extras", "Hardware + packaging")} />
                <CostRow {...line("cad", "CAD / design")} />
                <CostRow {...line("failure", "Failure reserve")} />
                <CostRow
                  label="Total production cost"
                  detail={details?.cost}
                  value={estimate ? formatPeso(estimate.cost) : "—"}
                  emphasized
                />

                <StepHeading
                  step="2"
                  title="Selling price"
                  note={settings.pricingMode === "margin" ? "Target gross margin" : "Markup on cost"}
                />
                <CostRow
                  label={`Profit (${settings.pricingMode === "margin" ? "margin" : "markup"} ${inputs.profitPercent}%)`}
                  detail={details?.profitAmount}
                  value={estimate ? `+${formatPeso(estimate.profitAmount)}` : "—"}
                />
                <CostRow
                  label="Price before discount"
                  detail={details?.beforeDiscount}
                  value={estimate ? formatPeso(estimate.beforeDiscount) : "—"}
                  emphasized
                />

                <StepHeading step="3" title="Adjustments" note="Applied in this order" />
                <CostRow {...line("discount", "Discount", "−")} />
                <CostRow {...line("rush", "Rush fee", "+")} />
                <CostRow {...line("minimumAdjustment", "Minimum order top-up", "+")} />
                <CostRow {...line("paymentFee", "Payment fee allowance", "+")} />
                <CostRow {...line("tax", "Tax", "+")} />
                <div className="flex items-center justify-between gap-4 border-t border-zinc-600 pt-3 text-base font-semibold">
                  <span>Final order price · {estimate?.quantity ?? "—"} {estimate?.quantity === 1 ? "piece" : "pieces"}</span>
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

function CostRow({
  label,
  detail,
  value,
  emphasized = false,
  included,
  onToggle,
}: {
  label: string;
  detail?: string;
  value: string;
  emphasized?: boolean;
  included?: boolean;
  onToggle?: () => void;
}) {
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
