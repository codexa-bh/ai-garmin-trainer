import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import {
  emptyProfileFields,
  type ProfileFetchState,
  type ProfileFields,
  type ProfileResponse,
  type ProfileSaveState,
  type Status,
  type TrainerProfilePayload,
} from "./contracts";
import {
  profileStatusLabel,
  profileToFields,
  textToLines,
} from "./profile-fields";
import { readJsonResponse } from "./transport";

export function useProfileFeature({
  setStatus,
}: {
  setStatus: Dispatch<SetStateAction<Status>>;
}) {
  const [profileFields, setProfileFields] =
    useState<ProfileFields>(emptyProfileFields);

  const [profileFetchState, setProfileFetchState] =
    useState<ProfileFetchState>("idle");

  const [profileSaveState, setProfileSaveState] =
    useState<ProfileSaveState>("idle");

  const [isProfileDirty, setIsProfileDirty] = useState(false);

  const [profileMessage, setProfileMessage] = useState(
    "Saved local Profile will load from local SQLite.",
  );

  const profileDirtyRef = useRef(false);

  const profilePreferencesRef = useRef<Record<string, unknown>>({});

  const profileRequestRef = useRef(0);

  const profileSummary = profileStatusLabel(
    profileFetchState,
    profileSaveState,
    isProfileDirty,
  );

  const profileControlsDisabled =
    profileFetchState === "loading" || profileSaveState === "saving";

  function setProfileDirty(value: boolean) {
    profileDirtyRef.current = value;
    setIsProfileDirty(value);
  }

  function updateProfileField(key: keyof ProfileFields, value: string) {
    setProfileFields((current) => ({ ...current, [key]: value }));
    setProfileDirty(true);
    if (profileSaveState === "saved") setProfileSaveState("idle");
    setProfileMessage(
      "Unsaved changes. Save Profile to update trainer grounding.",
    );
  }

  function applyProfile(profile: TrainerProfilePayload) {
    setProfileFields(profileToFields(profile));
    profilePreferencesRef.current = profile.preferences ?? {};
    setProfileDirty(false);
  }

  async function loadProfile(trigger: "startup" | "manual") {
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    setProfileFetchState("loading");
    setProfileMessage(
      trigger === "manual"
        ? "Reloading saved local Profile…"
        : "Loading saved local Profile…",
    );

    try {
      const response = await fetch("/api/profile", { method: "GET" });
      const payload = await readJsonResponse<TrainerProfilePayload>(response);
      if (profileRequestRef.current !== requestId) return;
      setProfileFetchState("loaded");
      if (profileDirtyRef.current) {
        setProfileMessage(
          "Saved Profile is available, but current edits were preserved. Save them or reload Profile to replace the form.",
        );
        return;
      }
      applyProfile(payload);
      setProfileSaveState("saved");
      setProfileMessage("Saved Profile loaded from local SQLite.");
    } catch (error) {
      if (profileRequestRef.current !== requestId) return;
      setProfileFetchState("error");
      setProfileMessage(
        `Profile load failed without changing the form: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async function saveProfile() {
    const submittedProfile: TrainerProfilePayload = {
      goals: textToLines(profileFields.goals),
      sports: textToLines(profileFields.sports),
      constraints: textToLines(profileFields.constraints),
      preferences: profilePreferencesRef.current,
    };

    setProfileSaveState("saving");
    setProfileDirty(false);
    setProfileMessage("Saving Profile to local SQLite…");
    setStatus({ kind: "busy", message: "Profile: saving…" });

    try {
      const payload = await readJsonResponse<ProfileResponse>(
        await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(submittedProfile),
        }),
      );
      setProfileFetchState("loaded");
      setProfileSaveState("saved");
      if (profileDirtyRef.current) {
        setProfileMessage(
          "Previous Profile values were saved; current edits remain unsaved.",
        );
      } else {
        applyProfile(payload.profile ?? submittedProfile);
        setProfileMessage("Profile saved and ready for trainer grounding.");
      }
      setStatus({ kind: "ok", message: "Profile: saved to local SQLite." });
    } catch (error) {
      setProfileSaveState("error");
      setProfileDirty(true);
      setProfileMessage(
        `Profile save failed; unsaved edits are still in the form: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      setStatus({
        kind: "error",
        message: `Profile save failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }
  return {
    loadProfile,
    isProfileDirty,
    profileSaveState,
    profileSummary,
    profileMessage,
    profileFields,
    updateProfileField,
    profileControlsDisabled,
    saveProfile,
  };
}
