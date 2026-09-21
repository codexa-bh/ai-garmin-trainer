import type { ProfileStorage, TrainerProfile } from "./contracts";

function lines(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  if (typeof value === "string")
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

export function createProfile(storage: ProfileStorage) {
  return {
    read: () => storage.read(),
    save(body: Partial<TrainerProfile>) {
      return storage.save({
        goals: lines(body.goals),
        sports: lines(body.sports),
        preferences:
          typeof body.preferences === "object" &&
          body.preferences &&
          !Array.isArray(body.preferences)
            ? body.preferences
            : {},
        constraints: lines(body.constraints),
      });
    },
  };
}
