import type { Dispatch, SetStateAction } from "react";
import { type RefObject } from "react";
import { debugMessageSummary } from "./chat-presentation";
import {
  type AthleteBaselinePayload,
  type BodyMetricsPayload,
  type ChatMessage,
  type ProfileFields,
  type ProfileSaveState,
  type Status,
} from "./contracts";
import { dateLabel, dayListLabel, valueLabel } from "./formatting";
import { ProfileCard } from "./profile-card";
import { ModelSettingsCard } from "./model-settings-card";
import type { useModelSettings } from "./use-model-settings";
export function SettingsView({
  modelSettings,
  closeSettingsSheet,
  settingsCloseRef,
  isProfileDirty,
  profileSaveState,
  profileSummary,
  profileMessage,
  profileFields,
  updateProfileField,
  profileControlsDisabled,
  runInBackground,
  saveProfile,
  loadProfile,
  runAction,
  refreshSummary,
  athleteBaselineMessage,
  athleteBaseline,
  bodyMetricsMessage,
  bodyMetrics,
  detailGarminId,
  setDetailGarminId,
  backfillDetail,
  refreshDetailCoverage,
  llmDebugTracesEnabled,
  debugTraceMessages,
  diagnosticsOpen,
  setDiagnosticsOpen,
  status,
}: {
  modelSettings: ReturnType<typeof useModelSettings>;
  closeSettingsSheet: () => void;
  settingsCloseRef: RefObject<HTMLButtonElement | null>;
  isProfileDirty: boolean;
  profileSaveState: ProfileSaveState;
  profileSummary: string;
  profileMessage: string;
  profileFields: ProfileFields;
  updateProfileField: (key: keyof ProfileFields, value: string) => void;
  profileControlsDisabled: boolean;
  runInBackground: (work: Promise<unknown>) => void;
  saveProfile: () => Promise<void>;
  loadProfile: (trigger: "startup" | "manual") => Promise<void>;
  runAction: (label: string, request: () => Promise<Response>) => Promise<void>;
  refreshSummary: () => Promise<void>;
  athleteBaselineMessage: string;
  athleteBaseline: AthleteBaselinePayload | null;
  bodyMetricsMessage: string;
  bodyMetrics: BodyMetricsPayload | null;
  detailGarminId: string;
  setDetailGarminId: Dispatch<SetStateAction<string>>;
  backfillDetail: () => Promise<void>;
  refreshDetailCoverage: () => Promise<void>;
  llmDebugTracesEnabled: boolean;
  debugTraceMessages: ChatMessage[];
  diagnosticsOpen: boolean;
  setDiagnosticsOpen: Dispatch<SetStateAction<boolean>>;
  status: Status;
}) {
  return (
    <div className="modal-layer" role="presentation">
      <button
        type="button"
        className="settings-backdrop"
        aria-label="Close settings"
        onClick={closeSettingsSheet}
      />
      <aside
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
      >
        <header className="sheet-header">
          <div>
            <p className="section-kicker">Settings</p>
            <h2 id="settings-heading">Data &amp; settings</h2>
          </div>
          <button
            type="button"
            className="chrome-button"
            onClick={closeSettingsSheet}
            ref={settingsCloseRef}
          >
            Close
          </button>
        </header>

        <div className="settings-groups">
          <ModelSettingsCard modelSettings={modelSettings} />
          <ProfileCard
            isProfileDirty={isProfileDirty}
            profileSaveState={profileSaveState}
            profileSummary={profileSummary}
            profileMessage={profileMessage}
            profileFields={profileFields}
            updateProfileField={updateProfileField}
            profileControlsDisabled={profileControlsDisabled}
            runInBackground={runInBackground}
            saveProfile={saveProfile}
            loadProfile={loadProfile}
          />

          <details className="settings-card" open>
            <summary>Garmin data and sync</summary>
            <p>
              Set <code>GARMIN_MCP_TOKEN_DIR</code> in local env. Reuse existing
              credentials; only if needed, run <code>npm run garmin:auth</code>{" "}
              in a private terminal. Sync uses pinned local stdio reads.
              Verification checks file presence, not authentication validity.
              The app never sees your Garmin password.
            </p>
            <div className="button-row">
              <button
                type="button"
                onClick={() =>
                  runInBackground(
                    runAction("Verify connector", () => fetch("/api/sync")),
                  )
                }
              >
                Verify connector
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => runInBackground(refreshSummary())}
              >
                Refresh import summary
              </button>
            </div>
            <p className="helper-text" role="status" aria-live="polite">
              {athleteBaselineMessage}
            </p>
            {athleteBaseline ? (
              <dl className="compact-facts">
                <div>
                  <dt>Status</dt>
                  <dd>{athleteBaseline.availability}</dd>
                </div>
                <div>
                  <dt>Last successful refresh</dt>
                  <dd>{dateLabel(athleteBaseline.fetchedAt)}</dd>
                </div>
                <div>
                  <dt>Cycling FTP</dt>
                  <dd>
                    {valueLabel(athleteBaseline.values.cyclingFtpWatts, " W")}
                    {athleteBaseline.values.cyclingFtpMeasuredOn
                      ? ` (${athleteBaseline.values.cyclingFtpMeasuredOn})`
                      : ""}
                    {athleteBaseline.values.cyclingFtpSourceStale
                      ? " — source marked stale by connector"
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Available training days</dt>
                  <dd>
                    {dayListLabel(athleteBaseline.values.availableTrainingDays)}
                  </dd>
                </div>
                <div>
                  <dt>Preferred long-training days</dt>
                  <dd>
                    {dayListLabel(
                      athleteBaseline.values.preferredLongTrainingDays,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Configured max HR</dt>
                  <dd>
                    {athleteBaseline.values.configuredMaxHeartRateBpm
                      ? `${athleteBaseline.values.configuredMaxHeartRateBpm} bpm (Garmin FIT zones target)`
                      : "Unavailable from current Garmin source"}
                  </dd>
                </div>
                <div>
                  <dt>HR-zone boundaries</dt>
                  <dd>
                    {athleteBaseline.values.heartRateZones.boundaries.length
                      ? athleteBaseline.values.heartRateZones.boundaries
                          .map(
                            (zone) =>
                              `Z${zone.zone} ${zone.lowerBpm}-${zone.upperBpm ?? "max"}`,
                          )
                          .join(", ")
                      : "HR-zone boundaries unavailable"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>Not available until the local summary loads.</p>
            )}
            <p className="helper-text" role="status" aria-live="polite">
              {bodyMetricsMessage}
            </p>
            {bodyMetrics ? (
              <dl className="compact-facts" aria-label="Garmin body metrics">
                <div>
                  <dt>Body-metrics status</dt>
                  <dd>{bodyMetrics.availability}</dd>
                </div>
                <div>
                  <dt>Body metrics refreshed</dt>
                  <dd>{dateLabel(bodyMetrics.fetchedAt)}</dd>
                </div>
                <div>
                  <dt>Current weight</dt>
                  <dd>
                    {valueLabel(bodyMetrics.values.weightKg, " kg")}
                    {bodyMetrics.currentWeightSource === "weigh_in"
                      ? " (source: latest weigh-in)"
                      : bodyMetrics.currentWeightSource === "profile"
                        ? " (source: profile weight field)"
                        : ""}
                  </dd>
                </div>
                <div>
                  <dt>Height</dt>
                  <dd>{valueLabel(bodyMetrics.values.heightCm, " cm")}</dd>
                </div>
                <div>
                  <dt>Weight history</dt>
                  <dd>
                    {bodyMetrics.history.availability === "available"
                      ? `${bodyMetrics.history.count} rows (${bodyMetrics.history.rangeStart ?? "unknown"} to ${bodyMetrics.history.rangeEnd ?? "unknown"}${bodyMetrics.history.source ? `, source: ${bodyMetrics.history.source}` : ""})`
                      : bodyMetrics.history.availability}
                  </dd>
                </div>
                <div>
                  <dt>Weigh-in status</dt>
                  <dd>{bodyMetrics.weighInAvailability ?? "not attempted"}</dd>
                </div>
              </dl>
            ) : (
              <p>Body metrics not available until the local summary loads.</p>
            )}
            <div className="detail-tools">
              <label>
                Garmin activity ID
                <input
                  aria-label="Garmin activity ID"
                  placeholder="Garmin activity ID"
                  value={detailGarminId}
                  onChange={(event) => setDetailGarminId(event.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => runInBackground(backfillDetail())}
                >
                  Force refresh detail
                </button>
                <button
                  type="button"
                  onClick={() => runInBackground(refreshDetailCoverage())}
                >
                  Show detail coverage
                </button>
              </div>
            </div>
          </details>

          {llmDebugTracesEnabled ? (
            <details className="settings-card llm-debug-card" open>
              <summary>
                LLM debug traces{" "}
                <span className="pill">
                  {debugTraceMessages.length} assistant turns
                </span>
              </summary>
              <p>
                Local developer diagnostics are enabled by environment
                configuration. Traces may include private normalized
                Garmin/chat/tool context and are inspectable only on this
                loopback app; Settings does not edit env files.
              </p>
              <div className="debug-trace-list" aria-label="LLM debug traces">
                {debugTraceMessages.length ? (
                  debugTraceMessages.map((item) => (
                    <details className="debug-trace-item" key={item.id}>
                      <summary>{debugMessageSummary(item)}</summary>
                      {item.grounding?.debugTrace ? (
                        <pre>
                          {JSON.stringify(item.grounding.debugTrace, null, 2)}
                        </pre>
                      ) : (
                        <p>
                          No debug trace captured for this assistant message.
                        </p>
                      )}
                    </details>
                  ))
                ) : (
                  <p>No assistant messages in the active conversation yet.</p>
                )}
              </div>
            </details>
          ) : null}

          <details
            className="settings-card diagnostics-card"
            open={diagnosticsOpen}
            onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
          >
            <summary>
              <span>Diagnostics / Current operation</span>
              <span className={`pill ${status.kind}`}>{status.kind}</span>
            </summary>
            {diagnosticsOpen ? (
              <pre className={`status ${status.kind}`} aria-live="polite">
                {status.message}
              </pre>
            ) : null}
          </details>

          <details className="settings-card danger-card" open>
            <summary>Safety, privacy, and deletion</summary>
            <p>
              <strong>Private AI coaching.</strong> Responses may use the
              selected conversation context and normalized local Garmin evidence
              under the privacy and tool boundaries below.
            </p>
            <p>
              Provider disclosure: selected conversation context may be sent to
              the configured AI provider. Local safety boundary: run on
              localhost/private loopback only, never public or LAN-exposed.
              Garmin credential safety: authenticate out of band and never paste
              passwords, token contents, provider keys, or raw payloads into the
              app.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="danger-button"
                onClick={() =>
                  runInBackground(
                    runAction("Clear chat/profile", () =>
                      fetch("/api/delete", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ scope: "chat-profile" }),
                      }),
                    ),
                  )
                }
              >
                Clear chat/profile
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() =>
                  runInBackground(
                    runAction("Disconnect Garmin/delete data", () =>
                      fetch("/api/delete", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ scope: "garmin-all" }),
                      }),
                    ),
                  )
                }
              >
                Disconnect Garmin/delete data
              </button>
            </div>
          </details>
        </div>
      </aside>
    </div>
  );
}
