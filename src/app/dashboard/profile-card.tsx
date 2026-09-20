import { type ProfileFields, type ProfileSaveState } from "./contracts";

export function ProfileCard({
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
}: {
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
}) {
  return (
    <details className="settings-card profile-settings-card" open>
      <summary>
        Profile / trainer grounding{" "}
        <span className={`pill ${isProfileDirty ? "dirty" : profileSaveState}`}>
          {profileSummary}
        </span>
      </summary>
      <p>
        Set one item per line. Saved Profile data is loaded from local SQLite on
        startup, then used with imported Garmin facts.
      </p>
      <p className="helper-text" role="status" aria-live="polite">
        {profileMessage}
      </p>
      <label>
        Goals
        <textarea
          aria-label="Goals"
          value={profileFields.goals}
          onChange={(event) => updateProfileField("goals", event.target.value)}
          placeholder="Build hiking endurance"
          disabled={profileControlsDisabled}
        />
      </label>
      <label>
        Preferred sports
        <textarea
          aria-label="Preferred sports"
          value={profileFields.sports}
          onChange={(event) => updateProfileField("sports", event.target.value)}
          placeholder="hiking\nmountaineering"
          disabled={profileControlsDisabled}
        />
      </label>
      <label>
        Constraints
        <textarea
          aria-label="Constraints"
          value={profileFields.constraints}
          onChange={(event) =>
            updateProfileField("constraints", event.target.value)
          }
          placeholder="no running this week"
          disabled={profileControlsDisabled}
        />
      </label>
      <div className="button-row">
        <button
          type="button"
          onClick={() => runInBackground(saveProfile())}
          disabled={profileControlsDisabled}
        >
          {profileSaveState === "saving" ? "Saving…" : "Save Profile"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => runInBackground(loadProfile("manual"))}
          disabled={profileControlsDisabled}
        >
          Reload saved Profile
        </button>
      </div>
    </details>
  );
}
