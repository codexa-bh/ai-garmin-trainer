// Fixed synthetic presentation inputs only; never read operator state.
export const tableProse =
  "Synthetic evidence describes duration and partial credit with explicit limitations; descriptive prose should wrap at word boundaries.";
const tableToken = `https://example.test/${"unbroken".repeat(50)}`;
export function tableFixture(reordered = false): string {
  const headers = [
    "KPI",
    "Target",
    "Unit",
    "Evidence",
    "Points",
    "Calculation",
  ];
  const order = reordered ? [4, 3, 5, 0, 2, 1] : [0, 1, 2, 3, 4, 5];
  if (reordered) headers[4] = "Crédit";
  const rows = ["30 / 30", "25 / 25", "15 / 15", "0 / 10"].map((score) => [
    "**Easy work**",
    "150",
    "min",
    reordered ? tableToken : tableProse,
    score,
    tableProse,
  ]);
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${order.map((index) => row[index]).join(" | ")} |`)
    .join("\n");
}
export const simpleTableFixture =
  "| Metric | Average | Reference |\n| --- | --- | --- |\n| **Duration** | `42 min` | Synthetic reference |\n| Distance | 5 km | Synthetic reference |";
