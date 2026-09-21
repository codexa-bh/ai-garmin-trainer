import { getDatabase } from "./connection";
import type {
  TrainerMemoryCategory,
  TrainerMemoryStatus,
  StoredTrainerMemory,
  LegacyMemoryStorage,
} from "../memory/legacy-contracts";
type TrainerMemoryRow = {
  id: string;
  category: TrainerMemoryCategory;
  value: string;
  status: TrainerMemoryStatus;
  sourceType: string;
  sourceRef: string | null;
  provenanceText: string;
  validFrom: number | null;
  expiresAt: number | null;
  reconfirmAfter: number | null;
  supersedesId: string | null;
  supersededById: string | null;
  createdAt: number;
  updatedAt: number;
};

function mapTrainerMemory(row: TrainerMemoryRow): StoredTrainerMemory {
  return {
    id: row.id,
    category: row.category,
    value: row.value,
    status: row.status,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    provenanceText: row.provenanceText,
    validFrom: row.validFrom ? new Date(row.validFrom) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    reconfirmAfter: row.reconfirmAfter ? new Date(row.reconfirmAfter) : null,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export const legacyMemoryStorage: LegacyMemoryStorage = {
  insert(id, input, now) {
    getDatabase()
      .prepare(
        `insert into trainer_memory (id, category, value, status, source_type, source_ref, provenance_text, valid_from, expires_at, reconfirm_after, supersedes_id, created_at, updated_at)
       values (?, ?, ?, 'pending_confirmation', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.category,
        input.value,
        input.sourceType,
        input.sourceRef ?? null,
        input.provenanceText,
        input.validFrom?.getTime() ?? null,
        input.expiresAt?.getTime() ?? null,
        input.reconfirmAfter?.getTime() ?? null,
        input.supersedesId ?? null,
        now,
        now,
      );
  },
  confirm(id, supersedesId, now) {
    const db = getDatabase();
    db.transaction(() => {
      if (supersedesId) {
        db.prepare(
          "update trainer_memory set status = 'superseded', superseded_by_id = ?, updated_at = ? where id = ?",
        ).run(id, now, supersedesId);
      }
      db.prepare(
        "update trainer_memory set status = 'confirmed', updated_at = ? where id = ?",
      ).run(now, id);
    })();
  },
  get(id) {
    const row = getDatabase()
      .prepare(
        `select id, category, value, status, source_type as sourceType, source_ref as sourceRef, provenance_text as provenanceText, valid_from as validFrom, expires_at as expiresAt, reconfirm_after as reconfirmAfter, supersedes_id as supersedesId, superseded_by_id as supersededById, created_at as createdAt, updated_at as updatedAt from trainer_memory where id = ?`,
      )
      .get(id) as TrainerMemoryRow | undefined;
    return row ? mapTrainerMemory(row) : null;
  },
  expire(now) {
    const result = getDatabase()
      .prepare(
        `update trainer_memory set status = 'expired', updated_at = ?
       where status = 'confirmed' and ((expires_at is not null and expires_at <= ?) or (reconfirm_after is not null and reconfirm_after <= ?))`,
      )
      .run(now, now, now);
    return result.changes;
  },
  listActive(safeLimit) {
    const rows = getDatabase()
      .prepare(
        `select id, category, value, status, source_type as sourceType, source_ref as sourceRef, provenance_text as provenanceText, valid_from as validFrom, expires_at as expiresAt, reconfirm_after as reconfirmAfter, supersedes_id as supersedesId, superseded_by_id as supersededById, created_at as createdAt, updated_at as updatedAt
       from trainer_memory
       where status = 'confirmed'
       order by updated_at desc
       limit ?`,
      )
      .all(safeLimit) as TrainerMemoryRow[];
    return rows.map(mapTrainerMemory);
  },
  listReview(safeLimit) {
    const rows = getDatabase()
      .prepare(
        `select id, category, value, status, source_type as sourceType, source_ref as sourceRef, provenance_text as provenanceText, valid_from as validFrom, expires_at as expiresAt, reconfirm_after as reconfirmAfter, supersedes_id as supersedesId, superseded_by_id as supersededById, created_at as createdAt, updated_at as updatedAt
       from trainer_memory
       where status in ('pending_confirmation', 'confirmed')
       order by status = 'pending_confirmation' desc, updated_at desc
       limit ?`,
      )
      .all(safeLimit) as TrainerMemoryRow[];
    return rows.map(mapTrainerMemory);
  },
  setStatus(id, status, now) {
    // Values and single-row write ordering match the legacy lifecycle operations.
    getDatabase()
      .prepare(
        "update trainer_memory set status = ?, updated_at = ? where id = ?",
      )
      .run(status, now, id);
  },
};
