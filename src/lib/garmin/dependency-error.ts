// Closed, secret-free action errors. Never derive dependency facts from vendor text.
export type GarminDependencyReason = "launcher-unavailable" | "startup-unknown";

export class GarminDependencyError extends Error {
  constructor(readonly reason: GarminDependencyReason) {
    super(
      reason === "launcher-unavailable"
        ? "The Garmin connector launcher (uvx or its configured override) cannot execute. Check README Installation and native Settings technical tool paths, then explicitly retry. Saved data remains available."
        : "The Garmin connector could not start; its cause is unknown. Check uvx/compatible Python and the configured path using README Installation, then explicitly retry. Saved data remains available; sign-in is not an established remedy.",
    );
    this.name = "GarminDependencyError";
  }
}

export function garminDependencyReason(
  error: unknown,
): GarminDependencyReason | undefined {
  return error instanceof GarminDependencyError ? error.reason : undefined;
}
