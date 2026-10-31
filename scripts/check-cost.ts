import assert from "node:assert/strict";
import {
  ALL_INCLUDED,
  BAMBU_A1,
  calculateCost,
  costProblems,
  DEFAULT_COST_INPUTS,
  formatPeso,
  wearPerHour,
  type CostInputs,
} from "../lib/print-cost";

const base: CostInputs = { ...DEFAULT_COST_INPUTS, gramsPerUnit: 4, hoursPerUnit: 0.3 };
const cents = (value: number) => Math.round(value * 100) / 100;
const near = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);

function check(name: string, run: () => void) {
  run();
  console.log(`ok - ${name}`);
}

check("default A1 job matches the spec example", () => {
  assert.deepEqual(costProblems(base), []);
  const quote = calculateCost(base);
  assert.equal(cents(quote.material), 3.0);
  assert.equal(cents(quote.electricity), 0.53);
  assert.equal(cents(quote.wear), 3.3);
  assert.equal(cents(quote.overhead), 7.66);
  assert.equal(cents(quote.setup), 50.0);
  assert.equal(cents(quote.failure), 3.22);
  assert.equal(cents(quote.cost), 67.71);
  assert.equal(cents(quote.beforeDiscount), 108.34);
  assert.equal(cents(quote.minimumAdjustment), 0);
  assert.equal(cents(quote.finalOrder), 108.34);
  assert.equal(cents(quote.perUnit), 108.34);
  assert.equal(cents(quote.eligible), 64.49);
  assert.equal(cents(quote.profitAmount), 40.63);
  assert.equal(cents(quote.netProfit), 40.63);
});

check("net profit leaves out the payment fee and tax", () => {
  const quote = calculateCost({ ...base, paymentFeePercent: 3, taxPercent: 12 });
  near(quote.netProfit, quote.base - quote.cost, "net profit");
});

check("setup and CAD are charged once per order; per-unit costs scale", () => {
  const one = calculateCost({ ...base, cadFeePerOrder: 300, hardwarePerUnit: 12, packagingPerUnit: 5, finishingMinutesPerUnit: 3 });
  const ten = calculateCost({ ...base, quantity: 10, cadFeePerOrder: 300, hardwarePerUnit: 12, packagingPerUnit: 5, finishingMinutesPerUnit: 3 });
  near(ten.setup, one.setup, "setup");
  near(ten.cad, one.cad, "cad");
  near(ten.material, one.material * 10, "material");
  near(ten.electricity, one.electricity * 10, "electricity");
  near(ten.wear, one.wear * 10, "wear");
  near(ten.finish, one.finish * 10, "finishing");
  near(ten.extras, 170, "hardware + packaging");
  near(ten.machineHours, 3, "machine hours");
});

check("material reserve is applied once", () => {
  const quote = calculateCost({ ...base, materialReservePercent: 10 });
  near(quote.material, (4 / 1000) * 749 * 1.1, "material");
});

check("failure reserve covers eligible costs only and is not compounded", () => {
  const inputs = { ...base, hardwarePerUnit: 10, cadFeePerOrder: 20 };
  const quote = calculateCost(inputs);
  const eligible = quote.material + quote.electricity + quote.wear + quote.overhead + quote.setup + quote.finish + quote.extras + quote.cad;
  near(quote.failure, eligible * 0.05, "failure");
  near(quote.cost, eligible * 1.05, "cost");
});

check("margin differs from markup", () => {
  const markup = calculateCost({ ...base, profitPercent: 40 });
  const margin = calculateCost({ ...base, pricing: "margin", profitPercent: 40 });
  near(markup.beforeDiscount, markup.cost * 1.4, "markup");
  near(margin.beforeDiscount, margin.cost / 0.6, "margin");
  assert.ok(margin.beforeDiscount > markup.beforeDiscount);
});

check("discount, rush, minimum, payment fee, and tax apply in order", () => {
  const quote = calculateCost({ ...base, discountPercent: 10, rushFeePerOrder: 20, paymentFeePercent: 3, taxPercent: 12 });
  const afterDiscount = quote.beforeDiscount * 0.9;
  const afterRush = afterDiscount + 20;
  const base2 = Math.max(afterRush, 100);
  const withFee = base2 / 0.97;
  near(quote.discount, quote.beforeDiscount * 0.1, "discount");
  near(quote.minimumAdjustment, base2 - afterRush, "minimum");
  near(quote.paymentFee, withFee - base2, "payment fee");
  near(quote.tax, withFee * 0.12, "tax");
  near(quote.finalOrder, withFee * 1.12, "final");
});

check("minimum order price lifts a small order", () => {
  const quote = calculateCost({ ...base, setupMinutesPerOrder: 0 });
  assert.ok(quote.beforeDiscount < 100);
  near(quote.finalOrder, 100, "final");
  near(quote.minimumAdjustment, 100 - quote.beforeDiscount, "adjustment");
});

check("unchecked lines leave the price but are still worked out", () => {
  const quote = calculateCost(base, { ...ALL_INCLUDED, setup: false, minimumAdjustment: false });
  near(quote.setup, 50, "setup amount");
  const eligible = quote.material + quote.electricity + quote.wear + quote.overhead;
  near(quote.cost, eligible * 1.05, "cost without setup");
  near(quote.finalOrder, quote.cost * 1.6, "final without minimum");
  const noFailure = calculateCost(base, { ...ALL_INCLUDED, failure: false });
  near(noFailure.cost, calculateCost(base).cost - calculateCost(base).failure, "cost without failure reserve");
});

check("automatic depreciation uses price / lifespan + maintenance", () => {
  const auto = { ...BAMBU_A1, wearMode: "auto" as const, purchasePrice: 15000, lifespanHours: 5000, maintenancePerHour: 8 };
  near(wearPerHour(auto), 11, "auto rate");
  near(wearPerHour({ ...auto, manualWearPerHour: 50, wearMode: "manual" }), 50, "manual rate");
  near(calculateCost({ ...base, printer: { ...auto, purchasePrice: 30000 } }).wear, (6 + 8) * 0.3, "auto wear");
});

check("invalid inputs are reported instead of priced", () => {
  const problems = (patch: Partial<CostInputs>) => costProblems({ ...base, ...patch });
  assert.equal(problems({ hoursPerUnit: 0 }).length, 1);
  assert.equal(problems({ hoursPerUnit: Number.NaN }).length, 1);
  assert.equal(problems({ quantity: 0 }).length, 1);
  assert.equal(problems({ quantity: 1.5 }).length, 1);
  assert.equal(problems({ gramsPerUnit: -1 }).length, 1);
  assert.equal(problems({ pricing: "margin", profitPercent: 100 }).length, 1);
  assert.equal(problems({ pricing: "markup", profitPercent: 250 }).length, 0);
  assert.equal(problems({ paymentFeePercent: 100 }).length, 1);
  assert.equal(problems({ printer: { ...BAMBU_A1, wearMode: "auto", lifespanHours: 0 } }).length, 1);
  assert.equal(problems({ printer: { ...BAMBU_A1, electricityRate: Number.POSITIVE_INFINITY } }).length, 1);
});

check("valid inputs never produce NaN or Infinity", () => {
  const quote = calculateCost({ ...base, pricing: "margin", profitPercent: 99.9, paymentFeePercent: 99.9, taxPercent: 100, discountPercent: 100 });
  for (const [key, value] of Object.entries(quote)) assert.ok(Number.isFinite(value), `${key} is ${value}`);
});

check("peso formatting", () => {
  assert.equal(formatPeso(108.3376), "₱108.34");
  assert.equal(formatPeso(1234.5), "₱1,234.50");
  assert.equal(formatPeso(Number.NaN), "₱0.00");
});

console.log("cost ok");
