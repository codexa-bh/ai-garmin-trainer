import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  ChatModelId,
  ModelSettingsSnapshot,
} from "@/lib/model-settings/contracts";

async function readSettings(
  response: Response,
): Promise<ModelSettingsSnapshot> {
  if (!response.ok) throw new Error("settings response failed");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("invalid settings");
  const value = body as Partial<ModelSettingsSnapshot>;
  const modelId = (id: unknown) =>
    id === "deepseek-flash" || id === "gpt-6-luna";
  const nullableString = (text: unknown) =>
    text === null || typeof text === "string";
  if (
    !Array.isArray(value.options) ||
    !value.options.every(
      (option) =>
        option && modelId(option.id) && typeof option.label === "string",
    ) ||
    !(value.selected === null || modelId(value.selected)) ||
    !value.effective ||
    !["saved", "env"].includes(value.effective.source) ||
    typeof value.effective.available !== "boolean" ||
    !nullableString(value.effective.provider) ||
    !nullableString(value.effective.modelName) ||
    (value.unavailableReason !== undefined &&
      typeof value.unavailableReason !== "string")
  )
    throw new Error("invalid settings");
  return value as ModelSettingsSnapshot;
}

export function useModelSettings(open: boolean) {
  const [snapshot, setSnapshot] = useState<ModelSettingsSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const saving = useRef(false);

  async function load() {
    if (saving.current) return;
    const request = ++generation.current;
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/model-settings", {
        cache: "no-store",
      });
      const body = await readSettings(response);
      if (request !== generation.current) return;
      setSnapshot(body);
      setState("ready");
    } catch {
      if (request !== generation.current) return;
      setSnapshot(null);
      setState("error");
      setMessage(
        "Model settings could not be loaded. Use Retry model availability in chat.",
      );
    }
  }
  function retry() {
    load().catch(() => {
      setState("error");
      setMessage("Model settings could not be loaded.");
    });
  }
  const loadOnOpen = useEffectEvent(() => retry());
  useEffect(() => {
    // Schedule the external read after navigation commits; cancel unopened work.
    const timer = open ? setTimeout(() => loadOnOpen(), 0) : undefined;
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [open]);

  async function save(modelId: ChatModelId | null) {
    if (saving.current) return;
    saving.current = true;
    generation.current += 1;
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/model-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const body = await readSettings(response);
      setSnapshot(body);
      setState("ready");
      setMessage(
        "Saved. Subsequent trainer turns use this setting; running turns are unchanged.",
      );
    } catch {
      setState("error");
      setMessage(
        "Model setting could not be confirmed. Use Retry model availability in chat to refresh current availability and saved state.",
      );
    } finally {
      saving.current = false;
    }
  }
  function choose(modelId: ChatModelId | null) {
    save(modelId).catch(() => {
      setState("error");
      setMessage("Model setting could not be confirmed.");
    });
  }
  return { snapshot, state, message, choose, retry };
}
