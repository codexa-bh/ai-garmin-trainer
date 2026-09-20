import type { AnalysisRow } from "./sql-analysis";

/** One orchestration's transient handles, never shared or persisted. */
export class TrainerToolExecutionContext {
  readonly analysisResults = new Map<string, AnalysisRow[]>();

  dispose(): void {
    // Release registry references, not arrays retained by returned evidence.
    this.analysisResults.clear();
  }
}
