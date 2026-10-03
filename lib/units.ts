export type Unit = "mm" | "in";

export const MM_PER_IN = 25.4;

export function toDisplay(mm: number, unit: Unit) {
  return unit === "mm" ? mm : mm / MM_PER_IN;
}

export function fromDisplay(value: number, unit: Unit) {
  return unit === "mm" ? value : value * MM_PER_IN;
}

export function formatLength(mm: number, unit: Unit) {
  if (unit === "mm") return `${mm.toFixed(1)} mm`;
  return `${(mm / MM_PER_IN).toFixed(2)} in`;
}

export function formatSize(width: number, height: number, depth: number, unit: Unit) {
  const values =
    unit === "mm"
      ? [width, height, depth].map((value) => value.toFixed(1))
      : [width, height, depth].map((value) => (value / MM_PER_IN).toFixed(2));
  const suffix = unit === "mm" ? "mm" : "in";
  return `${values[0]} × ${values[1]} × ${values[2]} ${suffix}`;
}
