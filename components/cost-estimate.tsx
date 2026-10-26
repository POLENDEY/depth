"use client";

import { useEffect, useMemo, useState } from "react";
import type { BufferGeometry } from "three";
import type { KeychainModel } from "@/lib/geometry";

type CostSettings = {
  filamentPrice: string;
  waste: string;
  quantity: string;
  electricityRate: string;
  averagePower: string;
  wear: string;
  overhead: string;
  setupMinutes: string;
  laborRate: string;
  finishingMinutes: string;
  hardware: string;
  packaging: string;
  cad: string;
  failure: string;
  rush: string;
  pricingMode: "markup" | "margin";
  profit: string;
  minimum: string;
  discount: string;
  paymentFee: string;
  tax: string;
};

const DEFAULTS: CostSettings = {
  filamentPrice: "749",
  waste: "0",
  quantity: "1",
  electricityRate: "14.74",
  averagePower: "0.12",
  wear: "11",
  overhead: "25.54",
  setupMinutes: "15",
  laborRate: "200",
  finishingMinutes: "0",
  hardware: "0",
  packaging: "0",
  cad: "0",
  failure: "5",
  rush: "0",
  pricingMode: "markup",
  profit: "60",
  minimum: "100",
  discount: "0",
  paymentFee: "0",
  tax: "0",
};

type CostLine =
  | "material"
  | "electricity"
  | "wear"
  | "overhead"
  | "setup"
  | "finish"
  | "extras"
  | "cad"
  | "failure"
  | "discount"
  | "rush"
  | "minimumAdjustment"
  | "paymentFee"
  | "tax";

type Included = Record<CostLine, boolean>;

const ALL_INCLUDED: Included = {
  material: true,
  electricity: true,
  wear: true,
  overhead: true,
  setup: true,
  finish: true,
  extras: true,
  cad: true,
  failure: true,
  discount: true,
  rush: true,
  minimumAdjustment: true,
  paymentFee: true,
  tax: true,
};

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

function number(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function validateInputs(settings: CostSettings, grams: number, hours: number) {
  const numeric = Object.entries(settings).filter(([key]) => key !== "pricingMode");
  if (numeric.some(([, value]) => value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) {
    return "Enter valid non-negative numbers in all pricing fields.";
  }
  if (!Number.isFinite(grams) || grams < 0) return "Enter a valid non-negative filament usage.";
  if (!Number.isFinite(hours) || hours < 0) return "Enter a valid non-negative print time.";
  const quantity = Number(settings.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return "Quantity must be a whole number of at least 1.";
  }
  if (
    grams < 0 ||
    Number(settings.waste) > 100 ||
    Number(settings.failure) > 100 ||
    Number(settings.profit) > 95 ||
    Number(settings.discount) > 95 ||
    Number(settings.paymentFee) >= 100 ||
    Number(settings.tax) > 100
  ) {
    return "Check percentage limits: material/failure/tax up to 100%, markup/margin and discount up to 95%, and payment fee below 100%.";
  }
  return null;
}

function money(value: number) {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Every line is still computed so excluded ones can show what they would have added.
function calculateCost(settings: CostSettings, weight: number, hours: number, included: Included) {
  const value = Object.fromEntries(
    Object.entries(settings).map(([key, entry]) => [key, typeof entry === "string" ? number(entry) : entry]),
  ) as Record<string, number | string>;
  const kept = (line: CostLine, amount: number) => (included[line] ? amount : 0);
  const quantity = Math.max(1, Math.floor((value.quantity as number) || 1));
  const material = weight * (1 + (value.waste as number) / 100) * ((value.filamentPrice as number) / 1000) * quantity;
  const electricity =
    hours * (value.averagePower as number) * (value.electricityRate as number) * quantity;
  const wear = hours * (value.wear as number) * quantity;
  const overhead = hours * (value.overhead as number) * quantity;
  const setup = ((value.setupMinutes as number) / 60) * (value.laborRate as number);
  const finish = ((value.finishingMinutes as number) / 60) * (value.laborRate as number) * quantity;
  const extras = ((value.hardware as number) + (value.packaging as number)) * quantity;
  const cad = value.cad as number;
  const production =
    kept("material", material) +
    kept("electricity", electricity) +
    kept("wear", wear) +
    kept("overhead", overhead) +
    kept("setup", setup) +
    kept("finish", finish);
  const failure = production * ((value.failure as number) / 100);
  const cost = production + kept("failure", failure) + kept("extras", extras) + kept("cad", cad);
  const profit = value.profit as number;
  const beforeDiscount =
    settings.pricingMode === "margin" ? cost / (1 - profit / 100) : cost * (1 + profit / 100);
  const discount = beforeDiscount * ((value.discount as number) / 100);
  const afterDiscount = beforeDiscount - kept("discount", discount);
  const rush = value.rush as number;
  const afterRush = afterDiscount + kept("rush", rush);
  const minimumAdjustment = Math.max(0, (value.minimum as number) - afterRush);
  const base = afterRush + kept("minimumAdjustment", minimumAdjustment);
  const feeRate = Math.min(99, value.paymentFee as number) / 100;
  const paymentFee = feeRate ? base / (1 - feeRate) - base : 0;
  const pretax = base + kept("paymentFee", paymentFee);
  const tax = pretax * ((value.tax as number) / 100);
  const finalOrder = pretax + kept("tax", tax);

  return {
    material,
    electricity,
    wear,
    overhead,
    setup,
    finish,
    extras,
    cad,
    failure,
    cost,
    beforeDiscount,
    discount,
    rush,
    minimumAdjustment,
    paymentFee,
    tax,
    finalOrder,
    perUnit: finalOrder / quantity,
    quantity,
  };
}

export function CostEstimate({ model, modelName }: { model: KeychainModel | null; modelName: string }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CostSettings>(DEFAULTS);
  const [weightOverride, setWeightOverride] = useState<{ volume: number; grams: string } | null>(null);
  const [hoursOverride, setHoursOverride] = useState<string | null>(null);
  const [included, setIncluded] = useState<Included>(ALL_INCLUDED);

  const volume = useMemo(
    () => (model ? geometryVolume(model.base) + geometryVolume(model.text) : 0),
    [model],
  );
  const estimatedGrams = (volume / 1000) * PLA_DENSITY;
  const gramsText = weightOverride?.volume === volume ? weightOverride.grams : estimatedGrams.toFixed(1);
  const grams = gramsText.trim() === "" ? Number.NaN : Number(gramsText);
  const estimatedHours = estimatedGrams / ESTIMATED_GRAMS_PER_HOUR;
  const hoursValue =
    hoursOverride === null ? estimatedHours : hoursOverride.trim() === "" ? Number.NaN : Number(hoursOverride);
  const inputError = validateInputs(settings, grams, hoursValue);
  const estimate = inputError ? null : calculateCost(settings, grams, hoursValue, included);
  const line = (key: CostLine, label: string, sign = "") => ({
    label,
    value: estimate ? `${sign}${money(estimate[key])}` : "—",
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

  function patch<Key extends keyof CostSettings>(key: Key, value: CostSettings[Key]) {
    setSettings((current) => ({ ...current, [key]: value }));
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
                <p className="mt-1 text-sm text-zinc-500">{modelName} · Bambu Lab A1 · Philippine pesos</p>
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
                  label="Filament usage (g)"
                  value={gramsText}
                  onChange={(value) => setWeightOverride({ volume, grams: value })}
                  step="0.1"
                  max="100000"
                />
                <CostInput
                  id="cost-hours"
                  label="Print time / unit (hours)"
                  value={hoursOverride ?? estimatedHours.toFixed(2)}
                  onChange={setHoursOverride}
                  step="0.1"
                />
                <CostInput id="cost-qty" label="Quantity" value={settings.quantity} onChange={(value) => patch("quantity", value)} step="1" min="1" />
                <CostInput id="cost-spool" label="Filament price / kg (₱)" value={settings.filamentPrice} onChange={(value) => patch("filamentPrice", value)} />
                <CostInput id="cost-waste" label="Extra material reserve (%)" value={settings.waste} onChange={(value) => patch("waste", value)} max="100" />
                <CostInput id="cost-hardware" label="Hardware / unit (₱)" value={settings.hardware} onChange={(value) => patch("hardware", value)} />
                <CostInput id="cost-packaging" label="Packaging / unit (₱)" value={settings.packaging} onChange={(value) => patch("packaging", value)} />
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
                Filament usage starts from solid mesh volume at 1.24 g/cm³. Replace it with Bambu Studio&apos;s
                total filament grams (including supports and purge) for an accurate material cost.
              </p>
            </section>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Machine costs</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CostInput id="cost-electricity" label="Electricity rate (₱/kWh)" value={settings.electricityRate} onChange={(value) => patch("electricityRate", value)} />
                <CostInput id="cost-power" label="Average power (kW)" value={settings.averagePower} onChange={(value) => patch("averagePower", value)} step="0.01" />
                <CostInput id="cost-wear" label="Maintenance + depreciation (₱/h)" value={settings.wear} onChange={(value) => patch("wear", value)} />
                <CostInput id="cost-overhead" label="Other machine overhead (₱/h)" value={settings.overhead} onChange={(value) => patch("overhead", value)} />
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Electricity defaults to ₱14.74/kWh from your guide. Meralco&apos;s all-in residential rate changes
                by billing month; use the rate on your latest bill.
              </p>
            </section>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Labor and service costs</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CostInput id="cost-setup" label="Setup / cleanup (minutes)" value={settings.setupMinutes} onChange={(value) => patch("setupMinutes", value)} step="1" />
                <CostInput id="cost-labor" label="Labor rate (₱/hour)" value={settings.laborRate} onChange={(value) => patch("laborRate", value)} />
                <CostInput id="cost-finish" label="Finishing / unit (minutes)" value={settings.finishingMinutes} onChange={(value) => patch("finishingMinutes", value)} step="1" />
                <CostInput id="cost-cad" label="CAD / design fee (₱/order)" value={settings.cad} onChange={(value) => patch("cad", value)} />
                <CostInput id="cost-failure" label="Failure / reprint reserve (%)" value={settings.failure} onChange={(value) => patch("failure", value)} max="100" />
                <CostInput id="cost-rush" label="Rush order fee (₱)" value={settings.rush} onChange={(value) => patch("rush", value)} />
              </div>
            </section>

            <section className="mb-4 rounded-xl bg-zinc-50 p-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Selling price inputs</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="block text-xs text-zinc-600">
                  Pricing method
                  <select
                    value={settings.pricingMode}
                    onChange={(event) => patch("pricingMode", event.target.value as CostSettings["pricingMode"])}
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900"
                  >
                    <option value="markup">Markup on cost</option>
                    <option value="margin">Target gross margin</option>
                  </select>
                </label>
                <CostInput id="cost-profit" label="Markup / margin (%)" value={settings.profit} onChange={(value) => patch("profit", value)} max="95" />
                <CostInput id="cost-minimum" label="Minimum order price (₱)" value={settings.minimum} onChange={(value) => patch("minimum", value)} />
                <CostInput id="cost-discount" label="Quantity discount (%)" value={settings.discount} onChange={(value) => patch("discount", value)} max="95" />
                <CostInput id="cost-fee" label="Payment fee (%)" value={settings.paymentFee} onChange={(value) => patch("paymentFee", value)} step="0.1" max="90" />
                <CostInput id="cost-tax" label="Tax (%)" value={settings.tax} onChange={(value) => patch("tax", value)} step="0.1" max="100" />
              </div>
            </section>

            {inputError ? (
              <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {inputError}
              </p>
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
              <p className="mb-3 text-xs text-zinc-400">Uncheck a line to leave it out of the price.</p>
              <div className="space-y-2 text-sm">
                <CostRow {...line("material", "Material")} />
                <CostRow {...line("electricity", "Electricity")} />
                <CostRow {...line("wear", "Maintenance / depreciation")} />
                <CostRow {...line("overhead", "Other machine overhead")} />
                <CostRow {...line("setup", "Setup labor")} />
                <CostRow {...line("finish", "Finishing labor")} />
                <CostRow {...line("extras", "Hardware + packaging")} />
                <CostRow {...line("cad", "CAD / design")} />
                <CostRow {...line("failure", "Failure reserve")} />
                <CostRow label="Total production cost" value={estimate ? money(estimate.cost) : "—"} emphasized />
                <CostRow label="Price before discount" value={estimate ? money(estimate.beforeDiscount) : "—"} />
                <CostRow {...line("discount", "Discount", "−")} />
                <CostRow {...line("rush", "Rush fee")} />
                <CostRow {...line("minimumAdjustment", "Minimum price adjustment")} />
                <CostRow {...line("paymentFee", "Payment fee allowance")} />
                <CostRow {...line("tax", "Tax added")} />
                <div className="flex items-center justify-between gap-4 border-t border-zinc-600 pt-3 text-base font-semibold">
                  <span>Final order price · {estimate?.quantity ?? "—"} unit(s)</span>
                  <span className="text-right text-xl text-emerald-400">{estimate ? money(estimate.finalOrder) : "—"}</span>
                </div>
                <p className="text-xs text-zinc-300">
                  Per unit: {estimate ? money(estimate.perUnit) : "—"} · Estimated machine time:{" "}
                  {estimate ? (hoursValue * estimate.quantity).toFixed(1) : "—"} hours
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  min?: string;
  max?: string;
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
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm tabular-nums text-zinc-900"
      />
    </label>
  );
}

function CostRow({
  label,
  value,
  emphasized = false,
  included,
  onToggle,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  included?: boolean;
  onToggle?: () => void;
}) {
  const excluded = included === false;
  return (
    <div className={`flex items-center justify-between gap-4 ${emphasized ? "border-t border-zinc-600 pt-2 font-semibold" : ""}`}>
      {onToggle ? (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={included}
            onChange={onToggle}
            className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-400"
          />
          <span className={excluded ? "text-zinc-500 line-through" : "text-zinc-200"}>{label}</span>
        </label>
      ) : (
        <span className="text-zinc-200">{label}</span>
      )}
      <span
        className={`shrink-0 text-right font-medium tabular-nums ${excluded ? "text-zinc-500 line-through" : "text-white"}`}
      >
        {value}
      </span>
    </div>
  );
}
