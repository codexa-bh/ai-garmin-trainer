import { getDatabase } from "./connection";
import type { TrainerProfile } from "../profile/contracts";
export function getTrainerProfile(): TrainerProfile {
  const row = getDatabase()
    .prepare(
      "select goals_json as goalsJson, sports_json as sportsJson, preferences_json as preferencesJson, constraints_json as constraintsJson from trainer_profile where id = 'default'",
    )
    .get() as
    | {
        goalsJson: string;
        sportsJson: string;
        preferencesJson: string;
        constraintsJson: string;
      }
    | undefined;
  if (!row) return { goals: [], sports: [], preferences: {}, constraints: [] };
  return {
    goals: JSON.parse(row.goalsJson) as string[],
    sports: JSON.parse(row.sportsJson) as string[],
    preferences: JSON.parse(row.preferencesJson) as Record<string, string>,
    constraints: JSON.parse(row.constraintsJson) as string[],
  };
}

export function saveTrainerProfile(profile: TrainerProfile): TrainerProfile {
  getDatabase()
    .prepare(
      `insert into trainer_profile (id, goals_json, sports_json, preferences_json, constraints_json, updated_at)
       values ('default', ?, ?, ?, ?, ?)
       on conflict(id) do update set
         goals_json=excluded.goals_json,
         sports_json=excluded.sports_json,
         preferences_json=excluded.preferences_json,
         constraints_json=excluded.constraints_json,
         updated_at=excluded.updated_at`,
    )
    .run(
      JSON.stringify(profile.goals),
      JSON.stringify(profile.sports),
      JSON.stringify(profile.preferences),
      JSON.stringify(profile.constraints),
      Date.now(),
    );
  return getTrainerProfile();
}
