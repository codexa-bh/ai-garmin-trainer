export function finiteNumberLabel(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
      })
    : "Unavailable";
}

export function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export function valueLabel(value: number | null, suffix = ""): string {
  return value === null ? "Not available" : `${value}${suffix}`;
}

export function numberLabel(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  return value == null
    ? "Unavailable"
    : value.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
      });
}

export function dayListLabel(days: string[]): string {
  return days.length ? days.join(", ") : "Not available";
}
