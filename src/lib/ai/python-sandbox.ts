import { spawn } from "node:child_process";

export type GeneratedPythonAnalysisRequest = {
  script: string;
  bundle: unknown;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxResultBytes?: number;
};

export type GeneratedPythonAnalysisResult =
  | {
      status: "succeeded";
      result: unknown;
      stdout?: string;
      warnings: string[];
    }
  | {
      status: "rejected" | "failed";
      reason: string;
      message: string;
      warnings: string[];
    };

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_STDOUT_BYTES = 4096;
const DEFAULT_MAX_RESULT_BYTES = 12000;
const MAX_SCRIPT_BYTES = 12000;

const PYTHON_WRAPPER = String.raw`
import ast, contextlib, importlib, io, json, resource, signal, sys
DENIED_NAMES = {"open", "eval", "exec", "compile", "__import__", "input", "globals", "locals", "vars", "dir", "getattr", "setattr", "delattr", "memoryview", "breakpoint"}
DENIED_MODULES = {"os", "subprocess", "socket", "pathlib", "shutil", "requests", "urllib", "http", "ftplib", "sqlite3", "ctypes", "multiprocessing", "threading", "asyncio", "importlib", "builtins", "sys", "site", "pip"}
ALLOWED_MODULES = {"collections", "datetime", "decimal", "functools", "itertools", "json", "math", "statistics"}

def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = str(name).split(".")[0]
    if level != 0 or root not in ALLOWED_MODULES:
        raise ImportError("Generated Python attempted to import a denied module.")
    return importlib.import_module(name)

SAFE_BUILTINS = {"abs": abs, "all": all, "any": any, "bool": bool, "dict": dict, "enumerate": enumerate, "filter": filter, "float": float, "int": int, "isinstance": isinstance, "len": len, "list": list, "map": map, "max": max, "min": min, "print": print, "range": range, "round": round, "set": set, "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "zip": zip, "Exception": Exception, "ValueError": ValueError, "__import__": safe_import}

def fail(status, reason, message):
    print(json.dumps({"status": status, "reason": reason, "message": message, "warnings": []}))
    raise SystemExit(0)

request = json.load(sys.stdin)
script = request.get("script", "")
max_result = int(request.get("maxResultBytes", 12000))
max_stdout = int(request.get("maxStdoutBytes", 4096))
try:
    tree = ast.parse(script, mode="exec")
except SyntaxError as exc:
    fail("rejected", "syntax_error", str(exc)[:300])
for node in ast.walk(tree):
    if isinstance(node, ast.While):
        fail("rejected", "loop_disabled", "Generated Python while loops are disabled in the local sandbox.")
    if isinstance(node, ast.Import):
        names = [alias.name.split(".")[0] for alias in node.names]
        if any(name in DENIED_MODULES or name not in ALLOWED_MODULES for name in names):
            fail("rejected", "denied_import", "Generated Python attempted to import a denied module.")
    if isinstance(node, ast.ImportFrom):
        if node.level != 0:
            fail("rejected", "denied_import", "Generated Python attempted a relative import.")
        name = node.module.split(".")[0] if node.module else ""
        if name in DENIED_MODULES or name not in ALLOWED_MODULES:
            fail("rejected", "denied_import", "Generated Python attempted to import a denied module.")
    if isinstance(node, ast.Attribute) and "__" in node.attr:
        fail("rejected", "dunder_access", "Generated Python attempted dunder/introspection access.")
    if isinstance(node, ast.Name):
        if "__" in node.id:
            fail("rejected", "dunder_access", "Generated Python attempted dunder/introspection access.")
        if node.id in DENIED_NAMES or node.id in DENIED_MODULES:
            fail("rejected", "denied_name", f"Generated Python referenced denied name {node.id}.")

resource.setrlimit(resource.RLIMIT_CPU, (1, 1))
try:
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
except Exception:
    pass
signal.alarm(2)
bundle = request.get("bundle") or {}
namespace = {
    "__builtins__": SAFE_BUILTINS,
    "bundle": bundle,
    "datasets": bundle.get("datasets", {}) if isinstance(bundle, dict) else {},
    "tables": bundle.get("tables", {}) if isinstance(bundle, dict) else {},
    "manifest": bundle.get("manifest", {}) if isinstance(bundle, dict) else {},
    "request": bundle.get("request", "") if isinstance(bundle, dict) else "",
    "requestedCount": bundle.get("requestedCount", 10) if isinstance(bundle, dict) else 10,
    "RESULT": None,
}
stdout = io.StringIO()
try:
    with contextlib.redirect_stdout(stdout):
        exec(compile(tree, "<generated-garmin-analysis>", "exec"), namespace, namespace)
except BaseException as exc:
    fail("failed", "runtime_error", str(exc)[:300])
output = stdout.getvalue()
if len(output.encode("utf-8")) > max_stdout:
    fail("failed", "stdout_too_large", "Generated Python stdout exceeded the configured cap.")
result = namespace.get("RESULT", namespace.get("result"))
try:
    encoded = json.dumps(result)
except TypeError:
    fail("failed", "non_json_result", "Generated Python did not return a JSON-serializable result.")
if len(encoded.encode("utf-8")) > max_result:
    fail("failed", "result_too_large", "Generated Python result exceeded the configured cap.")
print(json.dumps({"status": "succeeded", "result": result, "stdout": output[:max_stdout], "warnings": []}))
`;

export async function runGeneratedPythonAnalysis(
  request: GeneratedPythonAnalysisRequest,
): Promise<GeneratedPythonAnalysisResult> {
  const scriptBytes = Buffer.byteLength(request.script, "utf8");
  if (scriptBytes === 0 || scriptBytes > MAX_SCRIPT_BYTES) {
    return {
      status: "rejected",
      reason: "script_size",
      message:
        "Generated Python script is empty or exceeds the sandbox script cap.",
      warnings: [],
    };
  }
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 250),
    5000,
  );
  const payload = JSON.stringify({
    script: request.script,
    bundle: request.bundle,
    maxStdoutBytes: request.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES,
    maxResultBytes: request.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
  });

  return await new Promise<GeneratedPythonAnalysisResult>((resolve) => {
    const child: ReturnType<typeof spawn> = spawn(
      "python3",
      ["-I", "-S", "-c", PYTHON_WRAPPER],
      {
        cwd: "/tmp",
        env: { NODE_ENV: "production", PATH: "/usr/bin:/bin" },
        stdio: "pipe",
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        status: "failed",
        reason: "timeout",
        message: "Generated Python exceeded the local sandbox timeout.",
        warnings: [],
      });
    }, timeoutMs);
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      resolve({
        status: "failed",
        reason: "python_unavailable",
        message: error.message.slice(0, 300),
        warnings: [],
      });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = stdout.trim().split("\n").at(-1);
      if (!line) {
        resolve({
          status: "failed",
          reason: "no_sandbox_result",
          message: (stderr || "Python sandbox returned no result.").slice(
            0,
            300,
          ),
          warnings: [],
        });
        return;
      }
      try {
        resolve(JSON.parse(line) as GeneratedPythonAnalysisResult);
      } catch {
        resolve({
          status: "failed",
          reason: "invalid_sandbox_result",
          message: line.slice(0, 300),
          warnings: [],
        });
      }
    });
    child.stdin!.end(payload);
  });
}
