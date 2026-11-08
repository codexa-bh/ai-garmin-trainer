import type { AnalysisRow } from "./analytics/contracts";
import type { ActivityPanelImage } from "../local-data/activity-visuals";

/** One orchestration's transient handles, never shared or persisted. */
export class TrainerToolExecutionContext {
  readonly analysisResults = new Map<string, AnalysisRow[]>();
  // Never returned in steps/debug/grounding; this invocation owns every byte.
  readonly activityImages = new Map<number, ActivityPanelImage[]>();
  private disposed = false;

  retainActivityImages(index: number, images: ActivityPanelImage[]): boolean {
    if (this.disposed || this.activityImages.has(index)) {
      for (const image of images) image.bytes.fill(0);
      return false;
    }
    this.activityImages.set(index, images);
    return true;
  }

  dispose(): void {
    // Release registry references, not arrays retained by returned evidence.
    this.analysisResults.clear();
    this.disposed = true;
    for (const images of this.activityImages.values()) {
      for (const image of images) image.bytes.fill(0);
    }
    this.activityImages.clear();
  }
}
