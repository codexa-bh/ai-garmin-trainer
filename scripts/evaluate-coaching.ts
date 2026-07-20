import {
  evaluateDeterministicReliability,
  summarizeReliability,
} from "../src/lib/ai/reliability-fixtures";

const results = evaluateDeterministicReliability();
const summary = summarizeReliability(results);
console.log(JSON.stringify({ ok: summary.passed, summary, results }, null, 2));
process.exitCode = summary.passed ? 0 : 1;
