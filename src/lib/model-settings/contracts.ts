export type ChatModelId = "deepseek-flash" | "gpt-6-luna";

type ModelOption = { id: ChatModelId; label: string };
type EffectiveChatModel = {
  provider: string | null;
  modelName: string | null;
  source: "saved" | "env";
  available: boolean;
};
export type ModelSettingsSnapshot = {
  options: ModelOption[];
  selected: ChatModelId | null;
  effective: EffectiveChatModel;
  unavailableReason?: string;
};
export type ModelConfiguration = {
  deepseekConfigured: boolean;
  openaiConfigured: boolean;
  inherited: Omit<EffectiveChatModel, "source">;
};
