import { expect, it } from "vitest";
import { safeConnectorFailure } from "../src/lib/garmin/mcp-client";

it("classifies connector failures without leaking raw token/path canaries or claiming expiry", () => {
  for (const raw of [
    "401 auth expired",
    "429 too many requests",
    "503 connection",
    "unexpected failure",
  ]) {
    const safe = safeConnectorFailure(
      `${raw}: /private/path-canary garmin_tokens.json token-canary`,
    );
    expect(safe).not.toContain("path-canary");
    expect(safe).not.toContain("token-canary");
    expect(safe).not.toContain("expired");
  }
  expect(safeConnectorFailure("429")).toContain("rate-limited");
  expect(safeConnectorFailure("503")).toContain("unavailable");
  expect(safeConnectorFailure("401")).toContain("could not be verified");
});
