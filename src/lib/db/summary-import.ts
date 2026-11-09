import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "./connection";
import {
  characters,
  explicitMemoryNoSave,
  minimizeSummarySource,
  type SummarySource,
} from "../memory/summary-policy";

type Manifest = {
  id: string;
  format_version: number;
  selection_json: string;
  checksum: string;
  position: number;
  state: string;
  privacy_generation: number;
  control_generation: number;
  manual_revision: number;
  cutoff: number;
};
function authority() {
  return getDatabase()
    .prepare(
      "select s.privacy_generation,c.generation as control_generation,c.manual_revision,c.cutoff,c.enabled from summary_state s,summary_control c where s.id=1 and c.id=1",
    )
    .get() as {
    privacy_generation: number;
    control_generation: number;
    manual_revision: number;
    cutoff: number;
    enabled: number;
  };
}
function seal(row: Omit<Manifest, "checksum" | "position" | "state">): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.format_version,
        row.id,
        row.selection_json,
        row.privacy_generation,
        row.control_generation,
        row.manual_revision,
        row.cutoff,
      ]),
    )
    .digest("hex");
}
function selection(row: Manifest): string[] {
  const done = getDatabase()
    .prepare(
      "select source_id from summary_import_disposition where manifest_id=? order by rowid limit 201",
    )
    .all(row.id) as { source_id: string }[];
  if (
    row.format_version !== 1 ||
    row.selection_json.length > 40000 ||
    row.checksum !== seal(row) ||
    row.position !== done.length
  )
    throw new Error("summary_import_unavailable");
  const ids: unknown = JSON.parse(row.selection_json);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== "string" || id.length > 160) ||
    new Set(ids).size !== ids.length ||
    !Number.isSafeInteger(row.position) ||
    row.position < 0 ||
    row.position > ids.length ||
    done.some((item, index) => item.source_id !== ids[index])
  )
    throw new Error("summary_import_unavailable");
  return ids as string[];
}
function current(row: Manifest): boolean {
  const now = authority();
  return (
    now.enabled === 1 &&
    row.privacy_generation === now.privacy_generation &&
    row.control_generation === now.control_generation &&
    row.manual_revision === now.manual_revision &&
    row.cutoff === now.cutoff
  );
}
function source(sourceId: string): SummarySource | null {
  const row = getDatabase()
    .prepare(
      `select e.event_seq as eventSeq,t.admission_seq as admissionSeq,t.source_version as version,m.content as user,m.created_at as createdAt,
    (select a.created_at from conversation_turn p join message a on a.id=p.assistant_id where p.conversation_id=t.conversation_id and p.admission_seq<t.admission_seq and p.status='completed' order by p.admission_seq desc limit 1) as referentCreatedAt,
    (select case when p.admission_seq>(select cutoff from summary_control where id=1) and not exists(select 1 from summary_suppression x where x.source_id=p.turn_id||':'||p.source_version) then a.content else null end from conversation_turn p join message a on a.id=p.assistant_id where p.conversation_id=t.conversation_id and p.admission_seq<t.admission_seq and p.status='completed' order by p.admission_seq desc limit 1) as referent,
    (select u.content from conversation_turn p join message u on u.id=p.user_id where p.conversation_id=t.conversation_id and p.admission_seq<t.admission_seq and p.status='completed' order by p.admission_seq desc limit 1) as referentUser
    from conversation_turn t join conversation_completion e on e.turn_id=t.turn_id join message m on m.id=t.user_id
    where t.turn_id||':'||t.source_version=? and t.status='completed' and t.summary_eligible=0
      and t.admission_seq>(select cutoff from summary_control where id=1)
      and not exists(select 1 from summary_suppression where source_id=?)
      and not exists(select 1 from summary_import_disposition where source_id=?)`,
    )
    .get(sourceId, sourceId, sourceId) as
    | (Omit<SummarySource, "sourceId" | "eligible"> & {
        referentUser: string | null;
      })
    | undefined;
  // Export authoritative original message time, not an admission/review clock.
  if (
    !row ||
    !Number.isSafeInteger(row.createdAt) ||
    Math.abs(row.createdAt!) > 8_640_000_000_000_000
  )
    return null;
  const { referentUser, referentCreatedAt, ...selected } = row;
  const referent =
    referentUser && !explicitMemoryNoSave(referentUser) ? row.referent : null;
  return {
    ...selected,
    referent,
    ...(referent && referentCreatedAt !== undefined
      ? { referentCreatedAt }
      : {}),
    sourceId,
    eligible: true,
  };
}
export function summaryImportInspection(includeCandidates = true) {
  const db = getDatabase();
  const rows = db
    .prepare("select * from summary_import order by rowid desc limit 10")
    .all() as Manifest[];
  const candidates = includeCandidates
    ? (db
        .prepare(
          `select t.turn_id||':'||t.source_version as id,t.conversation_id as conversationId from conversation_turn t
    where t.status='completed' and t.summary_eligible=0 and t.admission_seq>(select cutoff from summary_control where id=1)
    and not exists(select 1 from summary_suppression where source_id=t.turn_id||':'||t.source_version)
    and not exists(select 1 from summary_import_disposition where source_id=t.turn_id||':'||t.source_version)
    order by t.admission_seq desc limit 200`,
        )
        .all() as { id: string; conversationId: string }[])
    : [];
  return {
    manifests: rows.map((row) => ({
      id: row.id,
      state: row.state,
      position: row.position,
      total: selection(row).length,
    })),
    candidates: candidates.flatMap((candidate) => {
      const original = source(candidate.id);
      const minimized = original && minimizeSummarySource(original);
      return minimized
        ? [
            {
              ...candidate,
              text: minimized.user,
              referent: minimized.referent ?? null,
            },
          ]
        : [];
    }),
    exclusions:
      "Only explicitly linked completed Off turns after the current cutoff are eligible. Memory-private, suppressed, previously imported, unavailable-date, unproven legacy and unlinked historical records are excluded; no role-pair inference or migration timestamp grants export. Relative-time prose is anchored to original message dates, not the import date; availability does not select or import it.",
  };
}
export function createSummaryImport(ids: string[]): string {
  const db = getDatabase();
  return db.transaction(() => {
    const a = authority();
    if (
      !a.enabled ||
      !ids.length ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length
    )
      throw new Error("summary_import_selection_invalid");
    if (db.prepare("select 1 from summary_rebuild where state='active'").get())
      throw new Error("summary_import_busy");
    if (
      db
        .prepare(
          "select 1 from summary_import where state in ('active','paused')",
        )
        .get()
    )
      throw new Error("summary_import_busy");
    let scalars = 0;
    for (const id of ids) {
      const original = source(id);
      const minimized = original && minimizeSummarySource(original);
      if (!original || !minimized)
        throw new Error("summary_import_source_unavailable");
      scalars +=
        characters(original.user ?? "") +
        characters(minimized.referent ? (original.referent ?? "") : "");
    }
    if (scalars > 100000) throw new Error("summary_import_selection_limit");
    const id = randomUUID();
    db.prepare(
      "insert into summary_import(id,selection_json,state,privacy_generation,control_generation,manual_revision,cutoff) values(?,?,'active',?,?,?,?)",
    ).run(
      id,
      JSON.stringify(ids),
      a.privacy_generation,
      a.control_generation,
      a.manual_revision,
      a.cutoff,
    );
    db.prepare("update summary_import set checksum=? where id=?").run(
      seal({
        id,
        format_version: 1,
        selection_json: JSON.stringify(ids),
        ...a,
      }),
      id,
    );
    // This explicit reviewed selection is due, but existing native foreground
    // lifetime/spacing/spend/one-writer rules still own the next admission.
    db.prepare(
      "update summary_control set pending_since=?,reason=null,retry_at=0 where id=1",
    ).run(Date.now() - 120001);
    return id;
  })();
}
export function controlSummaryImport(
  id: string,
  action: "pause" | "resume" | "cancel",
): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    const row = db
      .prepare("select * from summary_import where id=?")
      .get(id) as Manifest | undefined;
    if (!row) throw new Error("summary_import_unavailable");
    const ids = selection(row);
    if (action === "resume") {
      if (
        row.state !== "paused" ||
        !current(row) ||
        ids.slice(row.position).some((id) => !source(id))
      )
        throw new Error("summary_import_review_required");
      db.prepare("update summary_import set state='active' where id=?").run(id);
      return false;
    } else {
      if (!["active", "paused", "review-required"].includes(row.state))
        throw new Error("summary_import_unavailable");
      db.prepare("update summary_import set state=? where id=?").run(
        action === "cancel" ? "cancelled" : "paused",
        id,
      );
      // No provider wait or generation reset. Drop the current writer lease so
      // an already-running candidate cannot commit after pause/cancel.
      const stopped = db
        .prepare(
          "update summary_attempt set outcome='interrupted' where job_id=(select job_id from summary_control where id=1) and outcome='admitted' and import_id=?",
        )
        .run(id).changes;
      if (stopped)
        db.prepare(
          "update summary_control set job_id=null,lease_until=0 where id=1",
        ).run();
      return Boolean(stopped);
    }
  })();
}
export function readSummaryImportBatch(expected?: {
  id: string;
  position: number;
}) {
  const row = (
    expected
      ? getDatabase()
          .prepare("select * from summary_import where id=? and state='active'")
          .get(expected.id)
      : getDatabase()
          .prepare(
            "select * from summary_import where state='active' order by rowid limit 1",
          )
          .get()
  ) as Manifest | undefined;
  if (!row) return null;
  if (!current(row) || (expected && expected.position !== row.position))
    throw new Error("summary_import_review_required");
  const ids = selection(row).slice(row.position, row.position + 20);
  const sources = ids.map(source);
  if (sources.some((value) => value === null))
    throw new Error("summary_import_source_unavailable");
  return {
    identity: { id: row.id, position: row.position },
    sources: sources as SummarySource[],
  };
}
export function publishSummaryImport(
  identity: { id: string; position: number },
  dispositions: { sourceId: string; reason: string }[],
): void {
  const db = getDatabase();
  const row = db
    .prepare("select * from summary_import where id=?")
    .get(identity.id) as Manifest;
  const ids = selection(row);
  if (
    !current(row) ||
    row.state !== "active" ||
    row.position !== identity.position ||
    !dispositions.length ||
    dispositions.some(
      (item, index) => item.sourceId !== ids[row.position + index],
    )
  )
    throw new Error("summary_import_conflict");
  for (const item of dispositions)
    db.prepare(
      "insert into summary_import_disposition(source_id,manifest_id,reason) values(?,?,?)",
    ).run(item.sourceId, identity.id, item.reason);
  const position = row.position + dispositions.length;
  db.prepare("update summary_import set position=?,state=? where id=?").run(
    position,
    position === ids.length ? "complete" : "active",
    identity.id,
  );
}
