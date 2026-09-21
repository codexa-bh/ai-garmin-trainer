import { legacyMemoryStorage } from "../db/legacy-memory-repository";
import { createLegacyMemory } from "./legacy-application";

const legacy = createLegacyMemory({
  storage: legacyMemoryStorage,
  now: () => Date.now(),
  id: (now) => `memory-${now}-${Math.random().toString(36).slice(2, 10)}`,
});

export const getTrainerMemory = legacy.get;
export const createTrainerMemoryProposal = legacy.propose;
export const confirmTrainerMemory = legacy.confirm;
export const expireDueTrainerMemories = legacy.expire;
export const listActiveTrainerMemories = legacy.listActive;
export const listTrainerMemoriesForReview = legacy.listReview;
export const rejectTrainerMemory = legacy.reject;
export const forgetTrainerMemory = legacy.forget;
