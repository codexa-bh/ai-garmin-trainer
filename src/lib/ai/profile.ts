import { z } from "zod";
import type { TrainerProfile } from "./context";

const profilePatchSchema = z.object({
  goals: z.array(z.string()).optional(),
  sports: z.array(z.string()).optional(),
  preferences: z.record(z.string(), z.string()).optional(),
  constraints: z.array(z.string()).optional(),
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export function applyProfilePatch(
  current: TrainerProfile,
  patchInput: unknown,
): TrainerProfile {
  const patch = profilePatchSchema.parse(patchInput);
  return {
    goals: patch.goals ?? current.goals,
    sports: patch.sports ?? current.sports,
    preferences: { ...current.preferences, ...(patch.preferences ?? {}) },
    constraints: patch.constraints ?? current.constraints,
  };
}
