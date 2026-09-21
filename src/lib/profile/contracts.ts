export type TrainerProfile = {
  goals: string[];
  sports: string[];
  preferences: Record<string, string>;
  constraints: string[];
};

export interface ProfileStorage {
  read(): TrainerProfile;
  save(profile: TrainerProfile): TrainerProfile;
}
