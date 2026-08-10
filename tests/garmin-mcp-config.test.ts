import { describe, expect, it } from "vitest";
import {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_PACKAGE_URL,
  GARMIN_MCP_SDK_REQUIREMENT,
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

  it("preserves the connector pin and explicit spawn-vector package constraint", () => {
    const args = garminMcpArgs(
      `--from ${GARMIN_MCP_PACKAGE_URL} --with ${GARMIN_MCP_SDK_REQUIREMENT} garmin-mcp`,
    );

    expect(args).toEqual([
      "--from",
      GARMIN_MCP_PACKAGE_URL,
      "--with",
      GARMIN_MCP_SDK_REQUIREMENT,
      "garmin-mcp",
    ]);
  });

  it("classifies incompatible explicit MCP SDK requirements", () => {
    expect(
      garminMcpSdkConstraintStatus([
        "--from",
        GARMIN_MCP_PACKAGE_URL,
        "--with",
        "mcp==2.0.0",
        "garmin-mcp",
      ]),
    ).toBe("incompatible");
  });
});
