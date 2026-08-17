import { describe, expect, it } from "vitest";
import {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_PACKAGE_URL,
  GARMIN_MCP_SDK_REQUIREMENT,
  GARMIN_MCP_SDK_VERSION,
  garminMcpArgs,
  garminMcpSdkConstraintStatus,
  mcpArgs,
} from "../src/lib/garmin/client";

describe("Garmin MCP uvx arguments", () => {
  it("adds the reviewed MCP SDK pin to the legacy connector package form", () => {
    const args = mcpArgs(
      `garmin-mcp@git+https://github.com/Taxuspt/garmin_mcp.git@${GARMIN_MCP_COMMIT}`,
    );

    expect(args).toEqual([
      "--from",
      GARMIN_MCP_PACKAGE_URL,
      "--with",
      GARMIN_MCP_SDK_REQUIREMENT,
      "garmin-mcp",
    ]);
  });

  it("preserves the connector pin and exact reviewed MCP 1.x SDK constraint", () => {
    const args = garminMcpArgs(
      `--from ${GARMIN_MCP_PACKAGE_URL} --with ${GARMIN_MCP_SDK_REQUIREMENT} garmin-mcp`,
    );

    expect(GARMIN_MCP_SDK_VERSION).toBe("1.28.1");
    expect(args).toEqual([
      "--from",
      GARMIN_MCP_PACKAGE_URL,
      "--with",
      "mcp==1.28.1",
      "garmin-mcp",
    ]);
  });

  it("classifies stale, ranged, and MCP 2.x SDK requirements as incompatible", () => {
    for (const requirement of ["mcp==1.23.1", "mcp>=1.28.1,<2", "mcp==2.0.0"]) {
      expect(
        garminMcpSdkConstraintStatus([
          "--from",
          GARMIN_MCP_PACKAGE_URL,
          "--with",
          requirement,
          "garmin-mcp",
        ]),
      ).toBe("incompatible");
    }
  });
});
