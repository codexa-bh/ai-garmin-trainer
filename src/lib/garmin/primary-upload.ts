export type PrimaryUpload =
  | {
      kind: "known";
      primaryId: string;
      /** Earliest possible upload instant. */
      uploadedAt: string;
      /** Latest possible instant when the source rendered whole seconds only. */
      uploadedThrough?: string;
      via?: "last-used";
    }
  | {
      kind: "unknown";
      reason:
        | "no-devices"
        | "ambiguous-primary"
        | "invalid-device"
        | "invalid-upload"
        | "unrecognized-reply"
        | "last-used-unavailable"
        | "last-used-mismatch"
        | "last-used-invalid";
    };
