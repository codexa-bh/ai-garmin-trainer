import type { LegacyMemoryStorage, MemoryProposal } from "./legacy-contracts";

export function createLegacyMemory(ports: {
  storage: LegacyMemoryStorage;
  now(): number;
  id(now: number): string;
}) {
  const storage = ports.storage;
  return {
    get: (id: string) => storage.get(id),
    propose(input: MemoryProposal) {
      const now = ports.now();
      const id = ports.id(now);
      storage.insert(
        id,
        {
          ...input,
          value: input.value.slice(0, 1000),
          provenanceText: input.provenanceText.slice(0, 500),
        },
        now,
      );
      return storage.get(id)!;
    },
    confirm(id: string) {
      const now = ports.now();
      const existing = storage.get(id);
      if (!existing) throw new Error(`Memory proposal not found: ${id}`);
      if (existing.status !== "pending_confirmation")
        throw new Error(`Only pending memories can be confirmed: ${id}`);
      storage.confirm(id, existing.supersedesId, now);
      return storage.get(id)!;
    },
    expire(now = ports.now()) {
      return storage.expire(now);
    },
    listActive(limit = 8, now = ports.now()) {
      storage.expire(now);
      return storage.listActive(Math.min(Math.max(Math.trunc(limit), 1), 20));
    },
    listReview(limit = 40) {
      return storage.listReview(Math.min(Math.max(Math.trunc(limit), 1), 80));
    },
    reject(id: string) {
      const existing = storage.get(id);
      if (!existing) throw new Error(`Memory proposal not found: ${id}`);
      if (existing.status !== "pending_confirmation")
        throw new Error(`Only pending memories can be rejected: ${id}`);
      storage.setStatus(id, "rejected", ports.now());
      return storage.get(id)!;
    },
    forget(id: string) {
      const existing = storage.get(id);
      if (!existing) throw new Error(`Memory not found: ${id}`);
      if (!["pending_confirmation", "confirmed"].includes(existing.status))
        throw new Error(
          `Only pending or confirmed memories can be forgotten: ${id}`,
        );
      storage.setStatus(id, "deleted", ports.now());
      return storage.get(id)!;
    },
  };
}
