# Coaching instructions and evidence sources

The runtime trainer contract is maintained in `src/lib/ai/trainer-instructions.ts`. This document records the authoring evidence and product-policy boundary; it is not a runtime web knowledge base and does not make the model a substitute for source material.

Access date for all links below: **2026-08-10**.

## Source selection criteria

Sources were selected for public accessibility, recognizable public-health or sports-science authority, stable publisher/DOI links, relevance to generally healthy adults, and usefulness without copying a proprietary protocol. Guidance is adopted only at principle level, with population and evidence limitations preserved. A source does not authorize claims about an individual that are absent from Profile, user statements, or fresh Garmin/tool evidence.

## Adopted sources and bounded guidance

| Publisher / title                                                                                     | Stable source                                                                               | Authority and applicability                                                                               | Adopted guidance                                                                                                                                    | Limits and prompt/scenario mapping                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World Health Organization — _WHO guidelines on physical activity and sedentary behaviour_             | https://www.who.int/publications/i/item/9789240015128                                       | International public-health guideline synthesizing population evidence for adults and other groups.       | Maintain a broad foundation across aerobic activity, muscle strengthening, regular participation, and gradual participation appropriate to ability. | Population guidance is not an individualized schedule or performance plan. Maps to `coaching`, `COACH-ENDURANCE-01`, `COACH-STRENGTH-01`, and `COACH-GENERAL-01`.               |
| American College of Sports Medicine — _Progression Models in Resistance Training for Healthy Adults_  | https://doi.org/10.1249/MSS.0b013e3181915670                                                | Position stand focused on resistance-training progression in healthy adults.                              | Strength work should be progressive and adapted to experience, goals, frequency, recovery, and observed response.                                   | Older position stand; not a mandate for fixed sets, repetitions, loads, or progression for every user. Maps to `coaching`, `hiking`, and `COACH-STRENGTH-01`.                   |
| International Olympic Committee — _How much is too much? (Part 1): load in sport and risk of injury_  | https://doi.org/10.1136/bjsports-2016-096581                                                | Consensus statement on load management in sport.                                                          | Consider load history, rapid changes, recovery, and individual response together; avoid turning one metric into certainty.                          | Elite-sport and injury-risk evidence does not establish a universal safe increase or diagnose an individual. Maps to `coaching`, `COACH-ENDURANCE-01`, and `COACH-RECOVERY-01`. |
| American College of Sports Medicine — _Exercise and Fluid Replacement_                                | https://doi.org/10.1249/mss.0b013e31802ca597                                                | Position stand on fluid replacement around exercise.                                                      | Hydration guidance should account for duration, conditions, individual sweat response, and practical monitoring rather than one universal intake.   | Needs and evidence vary by person, environment, acclimatization, and event; no fixed intake is embedded. Maps to `coaching`, `hiking`, and `HIKE-PREP-01`.                      |
| National Park Service — _Hiking Safety_                                                               | https://www.nps.gov/articles/hiking-safety.htm                                              | Public outdoor-safety guidance for trip preparation and changing conditions.                              | Hiking advice should consider route demands, weather/conditions, equipment, water, pacing, and preparation when those facts are known.              | Safety overview rather than a training trial; route, weather, altitude, pack, and terrain must not be inferred. Maps to `hiking`, `HIKE-PREP-01`, and `HIKE-DETAIL-02`.         |
| American College of Sports Medicine / CDC — _Physical Activity Guidelines for Americans, 2nd edition_ | https://health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf | US evidence review and public guideline spanning aerobic, muscle-strengthening, and progression concepts. | Regular aerobic and strengthening activity can be combined and scaled to current capacity; some activity is preferable to none.                     | Population targets are context, not a compulsory weekly prescription or guarantee of outcome. Maps to `identity`, `coaching`, and broad coaching scenarios.                     |

## Translation into the hidden contract

- **Broad coaching:** start with the user's goal, history, current capacity, preferences, constraints, and recovery context; progress from observed response instead of a fixed percentage or schedule.
- **Strength and endurance:** combine domains as appropriate to the user's sport and goal without inventing sets, loads, availability, or a universal plan.
- **Recovery:** use multiple contextual signals. Garmin sleep, HRV, stress, body battery, or recent load can inform discussion but never becomes a single deterministic readiness verdict.
- **Hiking specialization:** consider time-on-feet, ascent, descent, terrain/technicality, progressive route specificity, lower-body/trunk strength, balance, pacing, recovery, and environmental preparation. Pack load, weather, altitude, surface, nutrition, injury status, and route conditions remain unknown unless supplied or evidenced.
- **Fueling and hydration:** discuss context and options, disclose assumptions, and avoid universal quantities when individual/event evidence is unavailable.
- **Uncertainty:** label observations, user facts, calculations, general guidance, assumptions, and missing data distinctly.

## Application policy, not external scientific claims

The following are product and safety boundaries implemented by the app:

- Current user corrections and fresh server-authored Garmin/tool evidence outrank retrieved memory and prior assistant prose.
- The model sees normalized, bounded data classes and guarded tools only; it never receives credentials or unrestricted raw data.
- Consequential Garmin-derived comparisons, scores, trends, and projections require executed SQL and same-turn bounded math when custom calculation is needed. Simple code-owned display conversions are exempt.
- The configured provider handles medical-domain responses normally without an additional app-authored response rule. Server-side memory filtering still excludes diagnosis and treatment content from durable personalization memory.
- No fixed hiking score, training-load formula, generic calculator, runtime web retrieval, fine-tuning, or RAG is provided.

## Claims considered but rejected

- A universal weekly mileage or load increase percentage: simple and popular, but not sufficiently individualized or generalizable.
- A fixed Garmin readiness, demand, hiking, or recovery score authored by the app: would hide value judgments, overstate missing metrics, and violate the model-selected transparent-criteria boundary.
- Universal hydration or fueling quantities: individual, duration, intensity, climate, altitude, and acclimatization differences make a single rule misleading.
- Inferring terrain, weather, altitude exposure, pack weight, footwear, nutrition intake, injury status, strength loads, or goals from activity type alone.
- Treating summary activity rows as lap, FIT, stream, route, or terrain analysis.

## Maintenance and evaluation

Change evidence principles in this document first, then update the smallest relevant section in `trainer-instructions.ts` and add or revise a typed case in `coaching-scenarios.ts`. Tests should prove section composition, source precedence, available-data limits, tool routing, criteria disclosure, and rejected behavior without snapshotting provider prose or hardcoding one coaching answer.
