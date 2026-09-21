export type TrainerMemory = {
  id: string;
  category: "learned_preference" | "temporary_constraint" | "commitment";
  value: string;
  provenanceText: string;
  expiresAt: Date | null;
  reconfirmAfter: Date | null;
};

export type TrainerMemoryStatus =
  | "pending_confirmation"
  | "confirmed"
  | "expired"
  | "superseded"
  | "deleted"
  | "rejected";

export type TrainerMemoryCategory = TrainerMemory["category"];

export type StoredTrainerMemory = TrainerMemory & {
  status: TrainerMemoryStatus;
  sourceType: string;
  sourceRef: string | null;
  validFrom: Date | null;
  supersedesId: string | null;
  supersededById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MemoryProposal = {
  category: TrainerMemoryCategory;
  value: string;
  sourceType: string;
  sourceRef?: string | null;
  provenanceText: string;
  validFrom?: Date | null;
  expiresAt?: Date | null;
  reconfirmAfter?: Date | null;
  supersedesId?: string | null;
};
export interface LegacyMemoryStorage {
  get(id: string): StoredTrainerMemory | null;
  insert(id: string, input: MemoryProposal, now: number): void;
  confirm(id: string, supersedesId: string | null, now: number): void;
  expire(now: number): number;
  listActive(limit: number): StoredTrainerMemory[];
  listReview(limit: number): StoredTrainerMemory[];
  setStatus(id: string, status: "rejected" | "deleted", now: number): void;
}
