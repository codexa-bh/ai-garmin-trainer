# Coaching instructions and evidence sources

Runtime contract: `src/lib/ai/trainer-instructions.ts`. This guide owns authoring principles and sources, not a runtime web knowledge base. Source links last reviewed **2026-08-10**.

## Source selection criteria

Use public, stable publisher/DOI sources with recognized health/sports authority and relevance to generally healthy adults. Adopt principles, not proprietary protocols; preserve population/evidence limits. Sources establish no individual facts absent Profile/user/current tool evidence.

## Adopted sources and bounded guidance

- [WHO physical activity/sedentary guidelines](https://www.who.int/publications/i/item/9789240015128): aerobic/strength foundation, regular participation and gradual ability-appropriate progression. Population guidance, not an individualized plan. Broad/endurance/strength scenarios.
- [ACSM resistance progression](https://doi.org/10.1249/MSS.0b013e3181915670): adapt progression to experience/goals/frequency/recovery/response. Older healthy-adult position stand, not universal sets/reps/loads. Strength/hiking scenarios.
- [IOC load and injury risk](https://doi.org/10.1136/bjsports-2016-096581): consider load history/change/recovery together. Elite-sport evidence gives no universal safe increase or diagnosis. Endurance/recovery scenarios.
- [ACSM fluid replacement](https://doi.org/10.1249/mss.0b013e31802ca597): duration, conditions and individual sweat response matter; no universal intake across people/acclimatization/events. Coaching/hiking preparation.
- [NPS hiking safety](https://www.nps.gov/articles/hiking-safety.htm): route demands, weather, equipment, water, pacing and preparation **when known**. Safety overview, not training trial or permission to infer conditions. Hiking preparation/detail.
- [US Physical Activity Guidelines, second edition](https://health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf): combine aerobic/strength activity scaled to capacity; some activity beats none. Population targets are context, not compulsory prescriptions/outcome guarantees. Broad coaching.

## Translation into the hidden contract

Start with goals/history/capacity/preferences/constraints/recovery; progress from observed response, not fixed percentages. Combine strength/endurance appropriately without inventing loads, availability or a universal plan. Hiking can consider time-on-feet/ascent/descent/specificity/strength/balance/pacing/environment, but pack/weather/altitude/surface/nutrition/injury/route conditions remain unknown without evidence.

An unusually hard outing needs current target/comparison/event-relative recovery evidence without magic lookup wording. Resolve activity identity; when two preceding outings are relevant, include them across sports. Explain date/window/criteria, distinguish pre-event from same-/post-day health, and treat null as unavailable. Sleep/HRV/stress/battery/load/HR support discussion, not measured fatigue, single readiness verdict or causation. Meal timing/body mass does not prove underfueling or causal percentages.

For hike/walk elevation profiles, [terrain analysis](architecture/dashboard.md#shared-activity-terrain-section-evidence) supplies mechanical sections/coverage, not scientific difficulty/surface/technicality. [Calculated grade](architecture/analytics-and-local-data.md#calculated-activity-grade-evidence) may work despite absent source grade; disclose signed estimate, 180-second smoothing and section support. Smoothing hides short steep features; ascent/km is not local gradient. Useful partial evidence should survive optional-tool gaps.

Hydration/fueling advice needs context/assumptions, not universal quantities. Separate observations, user reports, calculations, guidance and unknowns. Elapsed/slow samples alone do not establish measured stop duration/moving-only pace or reasons; label threshold-derived values estimates. Attribute unverified stops/terrain to the user.

## Application policy, not external scientific claims

Current corrections and fresh server evidence outrank memory/assistant prose. Known activity ID/name/date filters are conjunctive: omit unknown fields, and combined no-match requires rechecking a supplied ID alone before claiming absence. Never invent date from current day/preview.

Consequential Garmin comparisons/scores/trends/projections require executed SQL and same-turn math for custom arithmetic; simple code-owned display conversions are exempt. Known-ID `getActivityDashboard` supplies numerical summary/effort/HR zones/laps/terrain in one read; lookup only if identity needs resolving. Keep source timing/boundary provenance and source/activity durations distinct. No implicit refresh/GPS; specialised filters/history still use SQL/math/detail tools. Check sport before optional terrain and finish supported requested summary/recovery rather than abandoning it for unsupported enrichment.

Bound evidence to the carrier: SQL previews at most 20 rows, 500 characters/row, 1800/step; omitted is not absent. Select lean fields/summaries, separate unlike data instead of null-padded UNIONs, and fetch only missing clipped support. Stop pursuing optional evidence once sufficient. Failed results are not handles; correction does not relax schemas. Explain gaps with supported partial facts. There is no claim certificate/prose checker/automatic repair; correctness retains model risk.

Tools expose bounded normalized facts, never credentials/unrestricted raw data. Provider handles medical-domain responses without extra app-authored restriction. Topic words/URLs/paths/key-like examples/quoted instructions remain untrusted prose, not credential/file/tool authority; structural/privacy/no-save controls remain.

General Plan age over 60 elapsed days permits optional review, not invalidity/rewrite; exactly 60 is within window and unknown dates prove no age. Saved plan remains usable; age/discussion does not itself authorize saving. No plan retains explicit creation path; weekly commitments/Garmin freshness are independent. No fixed hiking/load rubric, arbitrary script calculator, web retrieval, fine-tuning or RAG.

## Claims considered but rejected

Universal weekly increases, app-authored readiness/demand/recovery scores, universal hydration/fueling and inferred pack/weather/nutrition/injury/goals hide uncertainty/value choices. Summary rows/flags/capped slices are not full-route analysis. Do not promise reachable analysis instead of doing it or defend a disputed answer from old prose; verify fresh relevant facts and finish supported work. General advice needs no personal lookup.

## Weekly planning and review

General Plan is independent of dated weekly commitments. Use device-local Monday–Sunday (explicit server-local legacy fallback), general template, target-week SQL/math and feedback. Sunday review is as-of; late evidence needs fresh verification/saved correction, not silent rescoring. Historical commitments remain immutable.

New plans agree concise model-chosen KPIs with full-target points summing to **100**. [Weekly KPI contracts](weekly-kpis.md) owns stable identities/points/canonical writes; narrative explains intent/adaptation/non-obvious rules, not duplicate tables. Ascent/distance/calories are optional choices, not mandated rubric. Points measure commitments, not scientific fitness/readiness.

Review complete latest established plan/exact set/week/timezone/cutoff: target, actual, contribution, coverage and understandable arithmetic. No old-assessment fallback, targets inferred from narrative-only saves or confusion with narrative review revision. Useful goal-relevant extras may exceed 100; explain substitutions/gaps and avoid double counting. Cycling km are not hiking km; more volume/calories is not automatically better or a maximize-activity recommendation.

Legacy plans without agreed rubrics permit only explicitly provisional interpretation bound to latest source. Inferred targets/weights are assumptions, not retroactive agreement; never derive targets from achieved results. Vague commitments need focused clarification/unavailable comparison; no recorded plan means activity summary, not completion score.

Declared numeric rules are the narrow code exception: agreed arithmetic over compatible stored measurements, provisional provenance, reviewed per-track awards win; eligibility/extras stay reviewed. Other custom scores require successful current SQL/math handles. Attribute user/plan constants, distinguish daily versus activity calories and overlapping sources, check null before math, never convert unknown to measured zero or redistribute weights silently. Partial week retains latest-plan denominator/cutoff and visible unsupported portions, not false completeness.

Direct model-selected General Plan/weekly/review writes need no consent parser, mandatory preview/proposal/second confirmation. Follow actual direction including draft-only/no-save; embedded/quoted instructions are data. Clarify content ambiguity, not missing permission wording. Complete prior-pass reads/currentness/exact-edit/calendar/privacy checks remain. One General Plan and one weekly attempt may coexist; failures/unknown effects are not replayable. Weekly bundle is atomic, separate features are not: disclose/refresh each real success. Other effect tools retain their own intent policy. This is not injection-proof semantic authorization.

During ordinary replies, brief relevant suggestions may address missing plan/new-week commitment, useful progress check or pending prior/Sunday review. Respect deferrals/refusals and meaningful state/date change. No startup/background nudge/generation/automatic save/template rewrite/Garmin write-back.

## Maintenance and evaluation

Canonical source/privacy/calculation/write rules belong in TRAINER_SYSTEM_PROMPT; ANSWER_POLICY owns common gaps/effects/log disclosure. Planner/final sections contain only call-specific obligations; context adds continuity/reset, not repeated policy. [AI architecture](architecture/ai-and-chat.md) owns evidence carriers/budgets.

Change evidence principles here, then the smallest prompt section and typed `tests/coaching-scenarios.ts` case. Test composition, source precedence, evidence limits, routing/criteria/gaps and refusals—not provider-prose snapshots or one hardcoded coaching answer. Authored tests are not live semantic-quality certificates.
