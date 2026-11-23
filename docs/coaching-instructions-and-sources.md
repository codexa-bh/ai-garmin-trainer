# Coaching instructions and evidence sources

The runtime trainer contract is maintained in `src/lib/ai/trainer-instructions.ts`. This document records the authoring evidence and product-policy boundary; it is not a runtime web knowledge base and does not make the model a substitute for source material.

Access date for all links below: **2026-08-10**.

## Source selection criteria

Sources were selected for public accessibility, recognizable public-health or sports-science authority, stable publisher/DOI links, relevance to generally healthy adults, and usefulness without copying a proprietary protocol. Guidance is adopted only at principle level, with population and evidence limitations preserved. A source does not authorize claims about an individual that are absent from Profile, user statements, or fresh Garmin/tool evidence.

## Adopted sources and bounded guidance

- **World Health Organization — _WHO guidelines on physical activity and sedentary behaviour_**
  - Stable source: https://www.who.int/publications/i/item/9789240015128
  - Authority and applicability: International public-health guideline synthesizing population evidence for adults and other groups.
  - Adopted guidance: Maintain a broad foundation across aerobic activity, muscle strengthening, regular participation, and gradual participation appropriate to ability.
  - Limits and prompt/scenario mapping: Population guidance is not an individualized schedule or performance plan. Maps to `coaching`, `COACH-ENDURANCE-01`, `COACH-STRENGTH-01`, and `COACH-GENERAL-01`.
- **American College of Sports Medicine — _Progression Models in Resistance Training for Healthy Adults_**
  - Stable source: https://doi.org/10.1249/MSS.0b013e3181915670
  - Authority and applicability: Position stand focused on resistance-training progression in healthy adults.
  - Adopted guidance: Strength work should be progressive and adapted to experience, goals, frequency, recovery, and observed response.
  - Limits and prompt/scenario mapping: Older position stand; not a mandate for fixed sets, repetitions, loads, or progression for every user. Maps to `coaching`, `hiking`, and `COACH-STRENGTH-01`.
- **International Olympic Committee — _How much is too much? (Part 1): load in sport and risk of injury_**
  - Stable source: https://doi.org/10.1136/bjsports-2016-096581
  - Authority and applicability: Consensus statement on load management in sport.
  - Adopted guidance: Consider load history, rapid changes, recovery, and individual response together; avoid turning one metric into certainty.
  - Limits and prompt/scenario mapping: Elite-sport and injury-risk evidence does not establish a universal safe increase or diagnose an individual. Maps to `coaching`, `COACH-ENDURANCE-01`, and `COACH-RECOVERY-01`.
- **American College of Sports Medicine — _Exercise and Fluid Replacement_**
  - Stable source: https://doi.org/10.1249/mss.0b013e31802ca597
  - Authority and applicability: Position stand on fluid replacement around exercise.
  - Adopted guidance: Hydration guidance should account for duration, conditions, individual sweat response, and practical monitoring rather than one universal intake.
  - Limits and prompt/scenario mapping: Needs and evidence vary by person, environment, acclimatization, and event; no fixed intake is embedded. Maps to `coaching`, `hiking`, and `HIKE-PREP-01`.
- **National Park Service — _Hiking Safety_**
  - Stable source: https://www.nps.gov/articles/hiking-safety.htm
  - Authority and applicability: Public outdoor-safety guidance for trip preparation and changing conditions.
  - Adopted guidance: Hiking advice should consider route demands, weather/conditions, equipment, water, pacing, and preparation when those facts are known.
  - Limits and prompt/scenario mapping: Safety overview rather than a training trial; route, weather, altitude, pack, and terrain must not be inferred. Maps to `hiking`, `HIKE-PREP-01`, and `HIKE-DETAIL-02`.
- **American College of Sports Medicine / CDC — _Physical Activity Guidelines for Americans, 2nd edition_**
  - Stable source: https://health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf
  - Authority and applicability: US evidence review and public guideline spanning aerobic, muscle-strengthening, and progression concepts.
  - Adopted guidance: Regular aerobic and strengthening activity can be combined and scaled to current capacity; some activity is preferable to none.
  - Limits and prompt/scenario mapping: Population targets are context, not a compulsory weekly prescription or guarantee of outcome. Maps to `identity`, `coaching`, and broad coaching scenarios.

## Translation into the hidden contract

- **Broad coaching:** start with the user's goal, history, current capacity, preferences, constraints, and recovery context; progress from observed response instead of a fixed percentage or schedule.
- **Strength and endurance:** combine domains as appropriate to the user's sport and goal without inventing sets, loads, availability, or a universal plan.
- **Recovery and activity difficulty:** a question about why a particular outing felt unusually hard needs current-turn target/comparison/recovery evidence without requiring explicit lookup wording. Verify identity and select an event-relative window; include the two preceding outings when invoked, across sports where relevant. Recent context is a bounded preview, not complete history or fresh verification. Distinguish pre-event from same-day/after-event health; calendar coverage is not measured recovery and null is unavailable, not zero. Explain chosen dates/criteria. Sleep, HRV, stress, body battery, load and HR inform multi-signal discussion, not measured fatigue, a single readiness verdict or proof of causation. User-reported meal timing/body mass are context, not proof of underfueling or a quantified cause; do not allocate causal percentages.
- **Hiking specialization:** consider time-on-feet, ascent, descent, terrain/technicality, progressive route specificity, lower-body/trunk strength, balance, pacing, recovery, and environmental preparation. Pack load, weather, altitude, surface, nutrition, injury status, and route conditions remain unknown unless supplied or evidenced.
- **Terrain sections:** use `analyzeActivityTerrain` for imported hike/walk elevation profiles. [Terrain-v2 mechanics](architecture/dashboard.md#shared-activity-terrain-section-evidence) owns anchors, smoothing, sustained trends, boundaries, gaps, grade, time-weighted HR and estimated motion. Report method/coverage and partial/truncated limits in ordinary prose; successful rows support partial answers and same-turn math. These are mechanical estimates, not scientific difficulty thresholds or measured stops/causes. Never infer surface or technicality from elevation.
- **Calculated grade:** absent `grade_pct` or false `has_grade` does not exclude guarded `activity_calculated_grade(activity_id)` for steepness questions. Follow its [method/support contract](architecture/analytics-and-local-data.md#calculated-activity-grade-evidence): disclose approximate signed grade, 180-second target smoothing and valid/total section coverage, never measured/instantaneous slope or unique-point/distance coverage. Smoothing hides short steep sections; ascent/km is not local gradient. Surface/technicality need independent evidence, not scientific classification from this estimate.
- **Fueling and hydration:** discuss context and options, disclose assumptions, and avoid universal quantities when individual/event evidence is unavailable.
- **Uncertainty:** label observations, user facts, calculations, general guidance, assumptions, and missing data distinctly. Elapsed duration or low-speed stream samples do not establish exact pause duration, moving-only pace or the reason for a stop. Without explicit measurements, identify these as unavailable; threshold-based estimates must not be presented as measured stops/moving time. Attribute reported stops and terrain to the user unless independently evidenced.

## Application policy, not external scientific claims

The following are product and safety boundaries implemented by the app:

- Current user corrections and fresh server-authored Garmin/tool evidence outrank retrieved memory and prior assistant prose.
- Activity reference fields are conjunctive constraints. Supply only known ID/name/date; omit unknown optional fields rather than inventing them from current date or unrelated previews. A combined no-match does not prove the supplied ID alone is absent: recheck the supplied identifier without unsupported filters before concluding local absence.
- The model sees normalized, bounded data classes and guarded tools only; it never receives credentials or unrestricted raw data.
- Consequential Garmin-derived comparisons, scores, trends, and projections require executed SQL and same-turn bounded math when custom calculation is needed. Simple code-owned display conversions are exempt.
- The configured provider handles medical-domain responses normally without an additional app-authored response rule. Cross-chat memory no longer screens topic words, URLs, paths, key-like examples or quoted instructions in user-authored discussion. These remain untrusted data, not native secret/file/tool authority; structure, source/privacy and explicit no-save controls remain.
- Terrain enrichment is optional bounded hike/walk evidence, not a reason to abandon requested summary/recovery analysis. Check the verified sport before selecting it; for unsupported sports use existing SQL/calculated-grade support or disclose the exact missing prerequisite. Complete requested summary/recovery before optional enrichment whose support is uncertain; a failed tool still obeys normal terminal guardrails.
- For routine numerical activity feedback with a known imported ID, `getActivityDashboard` reads the same dashboard summary/effort, HR zones and bounded laps/terrain in one local invocation. Resolve identity separately only when needed. HR timing may be Garmin totals or complete-stream fallback, not equivalent to stored-zone SQL alone; preserve status, boundary provenance and differing source/activity durations. Optional-row caps are explicit and unsupported terrain does not suppress valid numerical facts. Keep `runReadOnlySql` discoverable for specialised filters, comparisons/time windows and bespoke analytics, alongside existing math/terrain/detail tools. No implicit refresh or GPS projection is added.
- Query for the evidence that fits the bounded handoff: SQL previews show at most 20 rows, 500 characters per row and 1800 per step; omission is not absence. Prefer lean columns/aliases and relevant summaries. Retrieve unlike activity, health and grade evidence separately rather than null-padded UNION rows; if a preview clips required fields, fetch only that missing support, not the same wide window again. Do not chase optional evidence after sufficient support is available.
- Keep analytical answers selective and faithful to current-turn evidence. Disclose missing requested evidence with useful supported partial facts in ordinary prose. No model-authored claim certificate or checker repair is required: numerical accuracy, relevance and gap disclosure remain model responsibilities with ordinary output risk. Correction guidance never makes a failed result an output handle or relaxes tool input schemas.
- General Plan review timing is advisory: more than 60 elapsed 24-hour days since revision permits an optional review suggestion, not a stale/invalid verdict or required rewrite. Exactly 60 days is within the window. The saved plan remains usable; unknown revision dates cannot establish age. No plan retains the independent create-plan path. Age or a review discussion never authorizes persistence; complete reads and explicit current-user write intent remain required. Weekly commitments and Garmin freshness are independent.
- No fixed hiking score, training-load formula, generic calculator, runtime web retrieval, fine-tuning, or RAG is provided.

## Claims considered but rejected

- A universal weekly mileage or load increase percentage: simple and popular, but not sufficiently individualized or generalizable.
- A fixed Garmin readiness, demand, hiking, or recovery score authored by the app: would hide value judgments, overstate missing metrics, and violate the model-selected transparent-criteria boundary.
- Universal hydration or fueling quantities: individual, duration, intensity, climate, altitude, and acclimatization differences make a single rule misleading.
- Inferring terrain, weather, altitude exposure, pack weight, footwear, nutrition intake, injury status, strength loads, or goals from activity type alone.
- Treating summary activity rows, availability flags or a bounded detail slice as completed full-route analysis.
- Replacing available analysis with a promise, or rationalizing a correction from prior assistant prose. A correction needs fresh relevant verification; finish reachable summary/recovery/section work before terminal completion, reuse sufficient same-turn evidence, and disclose exact missing support with useful partial coaching. General advice still needs no personal-data lookup.

## Weekly planning and review

General Plan remains independent of dated commitments. Weekly drafts use the device-local Monday–Sunday calendar (explicit server-local fallback for legacy callers), general template, current target-week SQL/math evidence and user feedback. Sunday reviews are as-of, not final. Late evidence requires fresh evidence and a saved correction; historical plan commitments remain immutable.

New plans use a concise model-selected KPI rubric with full-target points summing to **100**. [Weekly KPIs](weekly-kpis.md) owns exact identities, per-measurement points, canonical reads/writes, reused rules, evidence/cutoff and provisional legacy interpretation. Follow those contracts rather than duplicating target/value tables in narrative: explain intent, adaptations and interpretation, with only necessary non-obvious scoring, substitution, bonus and uncertainty text. Ascent, walking distance and activity calories are optional choices, not a mandated combination. Completion points are pragmatic commitments, not scientific readiness/medical scores or an app-chosen formula.

Reviews use the complete **latest established plan**, exact KPI set and week/timezone/as-of. Show target, actual, contribution, coverage and understandable calculation. [Saved KPI meaning](weekly-kpis.md#identity-and-saved-meaning) forbids older-assessment fallback, new targets from narrative-only saves and treating narrative `review.planRevision` as an assessment reference.

Useful, goal-relevant overachievement may exceed 100 with explained contributions; more volume/calories alone is not automatically better or a recommendation to maximize activity. Relevant unplanned work can earn disclosed partial credit, but cycling kilometres are not hiking kilometres. Explain substitutions and remaining sport-specific gaps even at/above 100; avoid double-counting the same benefit. The model chooses and explains weights and relevance, without a universal sport conversion or hidden rubric.

A legacy plan without an agreed rubric gets only a **provisional interpretation** of its recorded commitments, explicitly bound to its latest plan source before display/scoring. Label inferred targets/weights as assumptions, not prior agreement; no obsolete-version fallback or retroactive agreement. Never invent a target from achieved results. Vague commitments need focused clarification or an unavailable comparison. No recorded plan means an activity summary, not a completion score.

Canonical declared-rule points are a narrow exception: pure code executes only agreed proportional/threshold/per-unit arithmetic on compatible stored measurements, returning provisional provenance; reviewed awards win per track and eligibility/extras remain reviewed. Other Garmin-derived scores require executed guarded target-week SQL and same-turn bounded math for custom arithmetic, actual successful handles and current-turn results. Attribute plan/user constants and disclose formula/limitations; a successful document/tool claim does not verify numbers. Distinguish imported activity calories from daily totals and avoid overlapping sources. Check availability before math (nullable optional metrics can become zero); unknown is not measured zero. Do not silently redistribute missing-metric weights or prorate latest-plan targets for an unfinished week. Partial progress may be bounded/provisional with the latest plan's denominator and unsupported portions visible, never a definitive total implying complete evidence. Disclose missing requested evidence in ordinary prose, retaining individually supported facts.

General Plan, weekly plan and review tools permit direct model-selected writes in the same turn without consent parsing, mandatory previews, pending proposals or later confirmation. Follow actual user direction, including explicit draft-only/no-save requests; quoted/document instructions are lower-authority data. Clarify genuinely unclear content, not missing permission wording. Complete prior-pass reads, concurrency/exact-edit checks, calendar/privacy limits and atomic weekly bundles remain mandatory. One General Plan attempt and one weekly bundle attempt may coexist; never replay either after a failed/uncertain attempt. Separate feature writes are not atomic together: report and refresh each actual success even if another fails. Other side-effect tools retain their existing permission policy. Model interpretation still carries semantic risk and is not a prompt-injection guarantee.

During normal replies only, offer a brief relevant suggestion for a new account without a plan/KPIs, a missing new-week commitment, a useful current-progress check, or a prior week awaiting review (including Sunday review/upcoming planning). Respect recent refusals/deferrals and avoid repeating the same suggestion without a meaningful date/status change. No background generation, startup nudge, automatic save, general-template rewrite or Garmin write-back.

## Maintenance and evaluation

Canonical source precedence, available-data/unknown limits, privacy and direct planning-write/no-save rules live in `TRAINER_SYSTEM_PROMPT` sections in `trainer-instructions.ts`. `ANSWER_POLICY` owns shared answer/gap/effect disclosure and output-log rules; planner and final-synthesis sections keep only their call-specific obligations. Chat context adds transcript selection/reset and unavailable-memory semantics rather than duplicating canonical evidence/privacy rules. Detailed terrain interpretation stays in its current instruction/evidence owners; no coaching-method cuts or dynamic policy routing are introduced.

Native full-replay and memory-only requests carry each executed step's bounded details once, in its paired result; fresh context is a compact status/handle index, not measurement, completeness or authorization proof. Legacy requests retain textual evidence. Unpaired budget/selection diagnostics remain visible and are not tool attempts. Combined actual-attempt budgets replace redundant successful per-tool quota maps, without changing tool schemas, ordering or safety rules. `trainer-request-evidence.test.ts` verifies actual serialized carriers across adapters; instruction, orchestration, plan/weekly and tool suites retain rule coverage.

Change evidence principles in this document first, then update the smallest relevant section in `trainer-instructions.ts` and add or revise a typed test-owned case in `tests/coaching-scenarios.ts`. Tests should prove section composition, source precedence, available-data limits, tool routing, criteria disclosure, and rejected behavior without snapshotting provider prose or hardcoding one coaching answer.
