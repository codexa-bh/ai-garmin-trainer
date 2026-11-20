/**
 * Closed, secret-free Garmin failure. Adapters raise subclasses whose message
 * is fixed vocabulary (never vendor bodies, headers, keys or tokens), so the
 * application may surface the message unchanged; anything else stays generic.
 */
export class GarminSafeFailure extends Error {}
