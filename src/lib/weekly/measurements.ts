import { addDays, validWeek, weekInterval, weeklyCalendar } from "./calendar";
import { projectKpis } from "./kpis";
import type { WeeklyStore, WeeklyTurn } from "./contracts";
import type {
  KpiConceptMeasurement,
  KpiMeasurementExecution,
  KpiMeasurementRun,
  KpiMeasurementWindow,
  KpiRead,
  KpiRecipe,
  KpiRecipeInput,
  KpiSet,
  KpiWeekMeasurements,
} from "./kpi-contracts";

/** Deliberate trainer history refresh shares the 12-week evidence bound. */
const MEASUREMENT_HISTORY_WEEKS = 12;
const MAX_QUEUED = 16;

export type MeasurementRefresh = {
  weekStart: string;
  status: "refreshed" | "no_plan" | "no_recipes" | "superseded";
  measured: KpiWeekMeasurements | null;
  failed: string[];
};

const signature = (track: KpiSet["items"][number]["tracks"][number]) =>
  JSON.stringify([track.kind, track.unit, track.meaning]);

function weekSet(store: WeeklyStore, weekStart: string): KpiSet | null {
  const state = store.readKpis(weekStart);
  const read = projectKpis(weekStart, state, undefined, store.read(weekStart));
  const id = read.latestPlanSetId;
  return state?.sets.find((set) => set.id === id) ?? null;
}

/** A recipe applies only where every track keeps its exact saved meaning. */
function applicable(recipe: KpiRecipe, set: KpiSet): boolean {
  const item = set.items.find((value) => value.conceptId === recipe.conceptId);
  return Boolean(
    item &&
    recipe.tracks.every((track) =>
      item.tracks.some(
        (value) =>
          value.key === track.key &&
          value.kind === "numeric" &&
          signature(value) === track.signature,
      ),
    ),
  );
}

export function createKpiMeasurements(
  store: WeeklyStore,
  execution: KpiMeasurementExecution,
  clock: () => Date,
  newId: () => string,
) {
  let tail: Promise<unknown> = Promise.resolve();
  const waiting = new Map<string, Promise<MeasurementRefresh>>();

  function timeZoneOf(weekStart: string, fallback: string): string {
    return (
      store.readKpis(weekStart)?.timeZone ??
      store.read(weekStart)?.timeZone ??
      fallback
    );
  }
  function windowOf(weekStart: string, timeZone: string): KpiMeasurementWindow {
    const interval = weekInterval(weekStart, timeZone);
    const startMs = Date.parse(interval.from);
    const endMs = Math.max(
      startMs,
      Math.min(Date.parse(interval.until), clock().getTime()),
    );
    return { weekStart, timeZone, startMs, endMs, asOfMs: endMs };
  }
  function versions(recipes: KpiRecipe[]) {
    return JSON.stringify(recipes.map((r) => [r.conceptId, r.version]).sort());
  }

  /** Short conditional write: refuses when plan, recipes or imported data moved. */
  function publish(
    window: KpiMeasurementWindow,
    set: KpiSet,
    recipes: KpiRecipe[],
    run: KpiMeasurementRun,
    expectedVersions = versions(recipes),
  ): KpiWeekMeasurements | null {
    return store.transaction(() => {
      if (weekSet(store, window.weekStart)?.id !== set.id) return null;
      const current = store
        .currentRecipes()
        .filter((recipe) =>
          recipes.some((r) => r.conceptId === recipe.conceptId),
        );
      if (versions(current) !== expectedVersions) return null;
      if (!run.basis || execution.basis(window) !== run.basis) return null;
      const previous = store.readMeasurements(window.weekStart);
      const at = clock().toISOString();
      const concepts: Record<string, KpiConceptMeasurement> = {
        ...previous?.concepts,
      };
      for (const outcome of run.outcomes) {
        const recipe = recipes.find((r) => r.conceptId === outcome.conceptId)!;
        concepts[outcome.conceptId] =
          outcome.status === "failed"
            ? {
                ...concepts[outcome.conceptId],
                failure: {
                  recipeVersion: recipe.version,
                  reason: outcome.reason,
                  at,
                },
              }
            : {
                success: {
                  recipeVersion: recipe.version,
                  status: outcome.status,
                  values: outcome.values,
                  signatures: Object.fromEntries(
                    recipe.tracks.map((track) => [track.key, track.signature]),
                  ),
                  measuredAt: at,
                  asOf: new Date(window.asOfMs).toISOString(),
                  basis: run.basis,
                },
              };
      }
      const state: KpiWeekMeasurements = {
        weekStart: window.weekStart,
        timeZone: window.timeZone,
        revision: newId(),
        concepts,
      };
      store.saveMeasurements(state);
      return state;
    });
  }

  async function measure(
    weekStart: string,
    timeZone: string,
  ): Promise<MeasurementRefresh> {
    const set = weekSet(store, weekStart);
    if (!set)
      return { weekStart, status: "no_plan", measured: null, failed: [] };
    const recipes = store
      .currentRecipes()
      .filter((recipe) => applicable(recipe, set));
    if (!recipes.length)
      return { weekStart, status: "no_recipes", measured: null, failed: [] };
    const window = windowOf(weekStart, timeZoneOf(weekStart, timeZone));
    // One bounded retry when imported data changed during execution.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = await execution.run(recipes, window);
      const measured = publish(window, set, recipes, run);
      if (measured)
        return {
          weekStart,
          status: "refreshed",
          measured,
          failed: run.outcomes
            .filter((outcome) => outcome.status === "failed")
            .map((outcome) => outcome.conceptId),
        };
    }
    return { weekStart, status: "superseded", measured: null, failed: [] };
  }

  /** Serialized, coalescing queue: one execution at a time, one waiter per week. */
  function enqueue(weekStart: string, timeZone: string) {
    const key = `${weekStart}/${timeZone}`;
    const existing = waiting.get(key);
    if (existing) return existing;
    if (waiting.size >= MAX_QUEUED)
      return Promise.reject(new Error("measurement_refresh_busy"));
    const work = tail.then(() => {
      waiting.delete(key);
      return measure(weekStart, timeZone);
    });
    waiting.set(key, work);
    tail = work.catch(() => undefined);
    return work;
  }

  /** Current week by default; a past week must be explicit and recent. */
  function refresh(timeZone: string, weekStart?: string) {
    const current = weeklyCalendar(clock(), timeZone).weekStart;
    const target = weekStart ?? current;
    if (
      !validWeek(target) ||
      target > current ||
      target < addDays(current, -7 * (MEASUREMENT_HISTORY_WEEKS - 1))
    )
      throw new Error("invalid_measurement_week");
    return enqueue(target, timeZone);
  }

  /**
   * Establish or revise reusable recipes. Each one must execute successfully on
   * the target and the previous week through the bounded path before atomic
   * acceptance; the target week then publishes from the same verified run.
   */
  async function saveRecipes(
    weekStart: string,
    inputs: KpiRecipeInput[],
    turn: WeeklyTurn,
    snapshots: KpiRead[],
  ) {
    const calendar = weeklyCalendar(clock(), turn.timeZone);
    if (
      !validWeek(weekStart) ||
      ![calendar.weekStart, calendar.upcoming].includes(weekStart) ||
      !inputs.length ||
      inputs.length > 6 ||
      new Set(inputs.map((input) => input.conceptId)).size !== inputs.length
    )
      throw new Error("invalid_recipe_bundle");
    const state = store.readKpis(weekStart);
    const set = weekSet(store, weekStart);
    const read = snapshots
      .filter((value) => value.weekStart === weekStart)
      .at(-1);
    if (
      !set ||
      !read?.complete ||
      read.revision !== (state?.revision ?? null) ||
      !read.sets.some((value) => value.id === set.id)
    )
      throw new Error("prior_complete_kpi_read_required");
    const existing = store.currentRecipes();
    const candidates: KpiRecipe[] = inputs.map((input) => {
      const item = set.items.find(
        (value) => value.conceptId === input.conceptId,
      );
      const tracks = input.tracks.map((key) =>
        item?.tracks.find(
          (track) => track.key === key && track.kind === "numeric",
        ),
      );
      if (
        !item ||
        !tracks.length ||
        new Set(input.tracks).size !== input.tracks.length ||
        tracks.some((track) => !track)
      )
        throw new Error("recipe_tracks_not_in_plan");
      const prior = existing.find((r) => r.conceptId === input.conceptId);
      return {
        conceptId: input.conceptId,
        version: (prior?.version ?? 0) + 1,
        sql: input.sql.trim(),
        tracks: tracks.map((track) => ({
          key: track!.key,
          signature: signature(track!),
        })),
        savedAt: clock().toISOString(),
      };
    });
    const changed = candidates.filter((candidate) => {
      const prior = existing.find((r) => r.conceptId === candidate.conceptId);
      return (
        !prior ||
        prior.sql !== candidate.sql ||
        JSON.stringify(prior.tracks) !== JSON.stringify(candidate.tracks)
      );
    });
    const timeZone = timeZoneOf(weekStart, turn.timeZone);
    const target = windowOf(weekStart, timeZone);
    const previous = windowOf(addDays(weekStart, -7), timeZone);
    const verification = changed.length
      ? await execution.run(changed, target)
      : null;
    const prior = changed.length
      ? await execution.run(changed, previous)
      : null;
    const failures = [
      ...(verification?.outcomes ?? []),
      ...(prior?.outcomes ?? []),
    ].flatMap((outcome) =>
      outcome.status === "failed"
        ? [{ conceptId: outcome.conceptId, reason: outcome.reason }]
        : [],
    );
    if (failures.length)
      return { status: "refused" as const, failures, saved: [] };
    const saved = store.transaction(() => {
      if (!store.isCurrentTurn(turn)) throw new Error("weekly_turn_superseded");
      if ((store.readKpis(weekStart)?.revision ?? null) !== read.revision)
        throw new Error("week_changed_read_again");
      for (const recipe of changed) store.saveRecipe(recipe);
      return changed.map(({ conceptId, version }) => ({ conceptId, version }));
    });
    const measured =
      verification && changed.length
        ? publish(target, set, changed, verification, versions(changed))
        : null;
    return {
      status: "saved" as const,
      saved,
      unchanged: candidates.length - changed.length,
      verified: {
        [weekStart]: verification?.outcomes ?? [],
        [previous.weekStart]: prior?.outcomes ?? [],
      },
      measured: measured ?? null,
    };
  }

  return {
    refresh,
    saveRecipes,
    recipes: () => store.currentRecipes(),
  };
}
