import { getTrainerProfile, saveTrainerProfile } from "../db/repository";
import { createProfile } from "./application";

export const trainerProfile = createProfile({
  read: () => getTrainerProfile(),
  save: (profile) => saveTrainerProfile(profile),
});
