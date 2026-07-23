import { loadEnvConfig } from "@next/env";
import { formatDoctorReport, runDoctor } from "../src/lib/diagnostics/doctor";
import { redactDiagnosticValue } from "../src/lib/diagnostics/redaction";

loadEnvConfig(process.cwd());

const json = process.argv.includes("--json");
const report = runDoctor();

if (json) {
  console.log(JSON.stringify(redactDiagnosticValue(report), null, 2));
} else {
  console.log(formatDoctorReport(report));
}

process.exitCode = report.ok ? 0 : 1;
