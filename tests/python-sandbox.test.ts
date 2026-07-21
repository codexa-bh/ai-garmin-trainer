import { describe, expect, it } from "vitest";
import { runGeneratedPythonAnalysis } from "../src/lib/ai/python-sandbox";

describe("generated Python sandbox", () => {
  it("runs bounded pure-data Python over the provided bundle", async () => {
    const result = await runGeneratedPythonAnalysis({
      script:
        "rows = sorted(bundle['activities'], key=lambda item: item['score'], reverse=True)\nRESULT = {'kind': 'ranking', 'rows': rows[:2]}",
      bundle: { activities: [{ score: 1 }, { score: 3 }, { score: 2 }] },
    });

    expect(result.status).toBe("succeeded");
    expect(result).toMatchObject({
      result: { kind: "ranking", rows: [{ score: 3 }, { score: 2 }] },
    });
  });

  it.each([
    ["filesystem", "RESULT = open('/etc/passwd').read()"],
    ["network", "import socket\nRESULT = {}"],
    ["process", "import subprocess\nRESULT = {}"],
    ["environment", "import os\nRESULT = os.environ"],
    ["dangerous import", "RESULT = __import__('os')"],
    ["eval", "RESULT = eval('1 + 1')"],
  ])("rejects denied %s access", async (_label, script) => {
    const result = await runGeneratedPythonAnalysis({ script, bundle: {} });
    expect(result.status).toBe("rejected");
    expect(JSON.stringify(result)).not.toContain("/etc/passwd");
  });

  it("fails closed on oversized stdout", async () => {
    const result = await runGeneratedPythonAnalysis({
      script: "print('x' * 5000)\nRESULT = {'ok': True}",
      bundle: {},
      maxStdoutBytes: 100,
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "stdout_too_large",
    });
  });
});
