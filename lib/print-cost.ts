// Print quotation math for a desktop FDM printer, in Philippine pesos. Kept apart from the UI
// so it can be checked on its own (scripts/check-cost.ts). Amounts stay unrounded here;
// round only for display.

export type PrinterProfile = {
  id: string;
  name: string;
  // Automatic depreciation: purchase price spread over the printing hours it should last.
  purchasePrice: number;
  lifespanHours: number;
  // Nozzles, plates, belts and the like, per printing hour (added to depreciation in auto mode).
  maintenancePerHour: number;
  // Typical average draw while printing, not the rated maximum.
  averagePowerKw: number;
  // From the latest electricity bill; it changes month to month.
  electricityRate: number;
  overheadPerHour: number;
  wearMode: "manual" | "auto";
  // Maintenance + depreciation per hour, when set by hand.
  manualWearPerHour: number;
};

// The A1's starting profile. The auto-mode numbers (₱15,000 over 5,000 h plus ₱8/h upkeep)
// add up to the same ₱11/h as the manual rate; change them to match your own printer.
export const BAMBU_A1: PrinterProfile = {
  id: "bambu-a1",
  name: "Bambu Lab A1",
  purchasePrice: 15000,
  lifespanHours: 5000,
  maintenancePerHour: 8,
  averagePowerKw: 0.12,
  electricityRate: 14.74,
  overheadPerHour: 25.54,
  wearMode: "manual",
  manualWearPerHour: 11,
};

export type PricingMethod = "markup" | "margin";

export type CostInputs = {
  gramsPerUnit: number;
  hoursPerUnit: number;
  quantity: number;
  filamentPricePerKg: number;
  materialReservePercent: number;
  hardwarePerUnit: number;
  packagingPerUnit: number;
  setupMinutesPerOrder: number;
  laborRatePerHour: number;
  finishingMinutesPerUnit: number;
  cadFeePerOrder: number;
  failureReservePercent: number;
  rushFeePerOrder: number;
  pricing: PricingMethod;
  // Markup on cost, or gross margin of the price, depending on `pricing`.
  profitPercent: number;
  minimumOrderPrice: number;
  discountPercent: number;
  paymentFeePercent: number;
  taxPercent: number;
  printer: PrinterProfile;
};

export const DEFAULT_COST_INPUTS: Omit<CostInputs, "gramsPerUnit" | "hoursPerUnit"> = {
  quantity: 1,
  filamentPricePerKg: 749,
  materialReservePercent: 0,
  hardwarePerUnit: 0,
  packagingPerUnit: 0,
  setupMinutesPerOrder: 15,
  laborRatePerHour: 200,
  finishingMinutesPerUnit: 0,
  cadFeePerOrder: 0,
  failureReservePercent: 5,
  rushFeePerOrder: 0,
  pricing: "markup",
  profitPercent: 60,
  minimumOrderPrice: 100,
  discountPercent: 0,
  paymentFeePercent: 0,
  taxPercent: 0,
  printer: BAMBU_A1,
};

// Lines of the quotation that can be left out.
export type CostLine =
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

export type Included = Record<CostLine, boolean>;

export const ALL_INCLUDED: Included = {
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

export function wearPerHour(printer: PrinterProfile) {
  if (printer.wearMode === "manual") return printer.manualWearPerHour;
  return printer.purchasePrice / printer.lifespanHours + printer.maintenancePerHour;
}

// Friendly problems with the inputs; an empty list means they can be priced.
export function costProblems(inputs: CostInputs) {
  const problems: string[] = [];
  const { printer } = inputs;
  const finite = (value: number) => Number.isFinite(value);
  const nonNegative = (value: number, message: string) => {
    if (!finite(value) || value < 0) problems.push(message);
  };
  const percent = (value: number, max: number, message: string, below = false) => {
    if (!finite(value) || value < 0 || (below ? value >= max : value > max)) problems.push(message);
  };
  nonNegative(inputs.gramsPerUnit, "Filament usage can't be negative.");
  if (!finite(inputs.hoursPerUnit) || inputs.hoursPerUnit <= 0) problems.push("Print time must be more than 0 hours.");
  if (!Number.isInteger(inputs.quantity) || inputs.quantity < 1) problems.push("Quantity must be a whole number of at least 1.");
  nonNegative(inputs.filamentPricePerKg, "Filament price can't be negative.");
  percent(inputs.materialReservePercent, 100, "Extra material reserve must be between 0% and 100%.");
  nonNegative(inputs.hardwarePerUnit, "Hardware cost can't be negative.");
  nonNegative(inputs.packagingPerUnit, "Packaging cost can't be negative.");
  nonNegative(inputs.setupMinutesPerOrder, "Setup time can't be negative.");
  nonNegative(inputs.laborRatePerHour, "Labor rate can't be negative.");
  nonNegative(inputs.finishingMinutesPerUnit, "Finishing time can't be negative.");
  nonNegative(inputs.cadFeePerOrder, "CAD / design fee can't be negative.");
  percent(inputs.failureReservePercent, 100, "Failure reserve must be between 0% and 100%.");
  nonNegative(inputs.rushFeePerOrder, "Rush fee can't be negative.");
  if (inputs.pricing === "margin") percent(inputs.profitPercent, 100, "Profit margin must be at least 0% and below 100%.", true);
  else nonNegative(inputs.profitPercent, "Markup can't be negative.");
  nonNegative(inputs.minimumOrderPrice, "Minimum order price can't be negative.");
  percent(inputs.discountPercent, 100, "Quantity discount must be between 0% and 100%.");
  percent(inputs.paymentFeePercent, 100, "Payment fee must be at least 0% and below 100%.", true);
  percent(inputs.taxPercent, 100, "Tax must be between 0% and 100%.");
  nonNegative(printer.electricityRate, "Electricity rate can't be negative.");
  nonNegative(printer.averagePowerKw, "Average power can't be negative.");
  nonNegative(printer.overheadPerHour, "Machine overhead can't be negative.");
  if (printer.wearMode === "manual") {
    nonNegative(printer.manualWearPerHour, "Maintenance + depreciation can't be negative.");
  } else {
    nonNegative(printer.purchasePrice, "Printer price can't be negative.");
    if (!finite(printer.lifespanHours) || printer.lifespanHours <= 0) problems.push("Printer lifespan must be more than 0 hours.");
    nonNegative(printer.maintenancePerHour, "Maintenance budget can't be negative.");
  }
  return problems;
}

export type CostBreakdown = ReturnType<typeof calculateCost>;

// The quotation, in this order:
//  1. production costs (per-unit costs × quantity, per-order costs once, failure reserve on those),
//  2. markup or margin price, 3. quantity discount, 4. rush fee, 5. minimum order price,
//  6. payment fee allowance (grossed up so the fee is covered), 7. tax.
// Every line is still worked out when left out, so the breakdown can show what it would add.
export function calculateCost(inputs: CostInputs, included: Included = ALL_INCLUDED) {
  const kept = (line: CostLine, amount: number) => (included[line] ? amount : 0);
  const { printer, quantity } = inputs;
  const machineHours = inputs.hoursPerUnit * quantity;

  const materialPerUnit = (inputs.gramsPerUnit / 1000) * inputs.filamentPricePerKg * (1 + inputs.materialReservePercent / 100);
  const material = materialPerUnit * quantity;
  const electricity = printer.electricityRate * printer.averagePowerKw * machineHours;
  const wearRate = wearPerHour(printer);
  const wear = wearRate * machineHours;
  const overhead = printer.overheadPerHour * machineHours;
  const setup = (inputs.setupMinutesPerOrder / 60) * inputs.laborRatePerHour;
  const finish = (inputs.finishingMinutesPerUnit / 60) * inputs.laborRatePerHour * quantity;
  const extras = (inputs.hardwarePerUnit + inputs.packagingPerUnit) * quantity;
  const cad = inputs.cadFeePerOrder;

  const eligible =
    kept("material", material) +
    kept("electricity", electricity) +
    kept("wear", wear) +
    kept("overhead", overhead) +
    kept("setup", setup) +
    kept("finish", finish) +
    kept("extras", extras) +
    kept("cad", cad);
  const failure = eligible * (inputs.failureReservePercent / 100);
  const cost = eligible + kept("failure", failure);

  const beforeDiscount =
    inputs.pricing === "margin" ? cost / (1 - inputs.profitPercent / 100) : cost * (1 + inputs.profitPercent / 100);
  const discount = beforeDiscount * (inputs.discountPercent / 100);
  const afterDiscount = beforeDiscount - kept("discount", discount);
  const rush = inputs.rushFeePerOrder;
  const afterRush = afterDiscount + kept("rush", rush);
  const minimumAdjustment = Math.max(0, inputs.minimumOrderPrice - afterRush);
  const base = afterRush + kept("minimumAdjustment", minimumAdjustment);
  const paymentFee = base / (1 - inputs.paymentFeePercent / 100) - base;
  const beforeTax = base + kept("paymentFee", paymentFee);
  const tax = beforeTax * (inputs.taxPercent / 100);
  const finalOrder = beforeTax + kept("tax", tax);

  return {
    material,
    electricity,
    wear,
    wearRate,
    overhead,
    setup,
    finish,
    extras,
    cad,
    eligible,
    failure,
    cost,
    profitAmount: beforeDiscount - cost,
    beforeDiscount,
    afterDiscount,
    afterRush,
    base,
    beforeTax,
    discount,
    rush,
    minimumAdjustment,
    paymentFee,
    tax,
    finalOrder,
    // What the shop keeps after its costs, the payment fee and tax.
    netProfit: finalOrder - cost - kept("paymentFee", paymentFee) - kept("tax", tax),
    perUnit: finalOrder / quantity,
    machineHours,
    quantity,
  };
}

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

export function formatPeso(value: number) {
  return PESO.format(Number.isFinite(value) ? value : 0);
}
