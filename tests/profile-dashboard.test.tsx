/** @vitest-environment jsdom */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainerDashboard } from "../src/app/trainer-dashboard";

const emptyChat = {
  conversationId: "default",
  messages: [],
  contextWindow: 0,
  historyLimit: 12,
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function syncStreamResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return Promise.resolve(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    ),
  );
}

function profile(
  goals: string[] = ["Build hiking endurance"],
  preferences: Record<string, unknown> = { coachingStyle: "direct" },
) {
  return {
    goals,
    sports: ["hiking", "mountaineering"],
    constraints: ["no running this week"],
    preferences,
  };
}

function openSettings() {
  fireEvent.click(screen.getByText("Data & settings"));
}

function setTranscriptMetrics(
  transcript: HTMLElement,
  values: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperties(transcript, {
    scrollHeight: { value: values.scrollHeight, configurable: true },
    clientHeight: { value: values.clientHeight, configurable: true },
    scrollTop: {
      value: values.scrollTop,
      configurable: true,
      writable: true,
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TrainerDashboard Profile hydration", () => {
  it("loads a saved Profile on no-auth startup but keeps it hidden until Data & settings opens", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(screen.queryByLabelText("Goals")).toBeNull();
    expect(screen.queryByText(/Sign in/i)).toBeNull();

    openSettings();

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Goals") as HTMLTextAreaElement).value,
      ).toBe("Build hiking endurance");
    });
    expect(
      (screen.getByLabelText("Preferred sports") as HTMLTextAreaElement).value,
    ).toBe("hiking\nmountaineering");
    expect(screen.queryByLabelText("Preferences JSON")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/dev-login",
      expect.anything(),
    );
  });

  it("keeps Diagnostics collapsed until opened", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      screen.queryByText(
        "Ready. Local trainer is available; verify the connector when needed.",
      ),
    ).toBeNull();

    fireEvent.click(screen.getByText("Current operation"));

    expect(
      await screen.findByText(
        "Ready. Local trainer is available; verify the connector when needed.",
      ),
    ).toBeTruthy();
  });

  it("shows only a generic transcript marker for stored tool grounding", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: "Synthesized trainer answer from local evidence.",
              createdAt: "2026-07-21T12:00:00.000Z",
              grounding: {
                tool: "rankActivities",
                summary: "Detailed ranking rows should stay hidden.",
                privacy: "Computed from local normalized SQLite only.",
              },
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      await screen.findByText(
        "Synthesized trainer answer from local evidence.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Used local Garmin data.")).toBeTruthy();
    expect(
      screen.queryByText("Detailed ranking rows should stay hidden."),
    ).toBeNull();
    expect(
      screen.queryByText("Computed from local normalized SQLite only."),
    ).toBeNull();
  });

  it("preserves dirty edits when a manual Profile reload returns late", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") {
        const profileGetCount = fetchMock.mock.calls.filter(
          ([calledUrl]) => String(calledUrl) === "/api/profile",
        ).length;
        if (profileGetCount === 1) return jsonResponse(profile([]));
        return jsonResponse(profile(["Persisted server value"]));
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    const goals = (await screen.findByLabelText(
      "Goals",
    )) as HTMLTextAreaElement;

    await waitFor(() => expect(goals.disabled).toBe(false));
    fireEvent.change(goals, { target: { value: "New local edit" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved Profile" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/current edits were preserved/i)).toBeTruthy();
    });
    expect(goals.value).toBe("New local edit");
  });

  it("saves line-based Profile fields and keeps the saved response in the form", async () => {
    let savedBody: unknown;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile" && init?.method === "GET")
        return jsonResponse(profile([]));
      if (url === "/api/profile" && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        return jsonResponse({ ok: true, profile: savedBody });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    const goals = (await screen.findByLabelText(
      "Goals",
    )) as HTMLTextAreaElement;
    const sports = screen.getByLabelText(
      "Preferred sports",
    ) as HTMLTextAreaElement;

    fireEvent.change(goals, {
      target: { value: "Summit endurance\nEasy recovery" },
    });
    fireEvent.change(sports, { target: { value: "hiking\ncycling" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    fireEvent.click(screen.getByText("Current operation"));

    await waitFor(() => {
      expect(screen.getByText("Profile: saved to local SQLite.")).toBeTruthy();
    });
    expect(savedBody).toMatchObject({
      goals: ["Summit endurance", "Easy recovery"],
      sports: ["hiking", "cycling"],
      constraints: ["no running this week"],
      preferences: { coachingStyle: "direct" },
    });
    expect(goals.value).toBe("Summit endurance\nEasy recovery");
  });
});

describe("TrainerDashboard athlete baseline summary", () => {
  it("renders read-only Garmin athlete baselines separately from Profile", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary")
        return jsonResponse({
          activities: 1,
          healthDays: 2,
          detailedActivities: 0,
          athleteBaseline: {
            availability: "partial",
            source: "garmin_mcp",
            fetchedAt: "2026-07-20T08:00:00.000Z",
            lastAttemptAt: "2026-07-20T08:00:00.000Z",
            preservedPrevious: false,
            values: {
              runningLactateThresholdHeartRateBpm: 168,
              cyclingLactateThresholdHeartRateBpm: null,
              rowingLactateThresholdHeartRateBpm: null,
              cyclingFtpWatts: 250,
              cyclingFtpMeasuredOn: "2026-07-19",
              cyclingFtpSourceStale: false,
              vo2MaxRunning: null,
              vo2MaxCycling: null,
              availableTrainingDays: ["monday", "wednesday"],
              preferredLongTrainingDays: ["sunday"],
            },
            unsupported: {
              configuredMaxHeartRate: true,
              completeHeartRateZoneBoundaries: true,
              reason: "not_exposed_by_pinned_connector",
            },
          },
        });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();

    expect(await screen.findByText("Garmin athlete baselines")).toBeTruthy();
    expect(screen.getByText("168 bpm")).toBeTruthy();
    expect(screen.getByText("250 W (2026-07-19)")).toBeTruthy();
    expect(
      screen.getAllByText("Not provided by the current pinned connector"),
    ).toHaveLength(2);
    expect(screen.queryByLabelText("Running threshold HR")).toBeNull();
  });
});

describe("TrainerDashboard primary Sync now", () => {
  it("shows Sync now in the trainer header without opening Data & settings", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    const syncButton = screen.getByRole("button", {
      name: "Sync now — import latest Garmin data",
    });
    expect(syncButton).toBeTruthy();
    expect(syncButton.textContent).toContain("Sync now");
  });

  it("omits no-op detail queue copy from non-detail Sync now progress", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") {
        return jsonResponse({
          activities: 247,
          healthDays: 933,
          detailedActivities: 247,
        });
      }
      if (url === "/api/sync" && init?.method === "POST") {
        return syncStreamResponse([
          {
            stage: "health",
            message: "Imported daily health 1/1: 2026-07-21.",
            activitiesImported: 247,
            healthDaysImported: 933,
          },
          {
            type: "result",
            status: "completed",
            activitiesImported: 247,
            healthDaysImported: 933,
            detailsProcessed: 0,
            detail: "done",
          },
        ]);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );
    fireEvent.click(screen.getByText("Current operation"));

    await waitFor(() => {
      const statusText =
        screen.getByText(/health: Imported daily health 1\/1/).textContent ??
        "";
      expect(statusText).toContain("activities 247, health days 933");
      expect(statusText).not.toContain("details 0/0");
    });
  });

  it("uses clear activity-detail wording for detail Sync now progress", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") {
        return jsonResponse({
          activities: 247,
          healthDays: 933,
          detailedActivities: 245,
        });
      }
      if (url === "/api/sync" && init?.method === "POST") {
        return syncStreamResponse([
          {
            stage: "detail",
            message: "Refreshing missing activity detail 3/5: 123456…",
            activitiesImported: 247,
            healthDaysImported: 933,
            detailsProcessed: 2,
            detailTotal: 5,
          },
        ]);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );
    fireEvent.click(screen.getByText("Current operation"));

    await waitFor(() => {
      const statusText =
        screen.getByText(/detail: Refreshing missing activity detail 3\/5/)
          .textContent ?? "";
      expect(statusText).toContain("activity details 2/5");
      expect(statusText).not.toContain(", details 2/5");
    });
  });

  it("preserves hidden preferences when saving visible Profile fields", async () => {
    let savedBody: unknown;
    const seededPreferences = { coachingStyle: "direct", maxWeeklyHours: 10 };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile" && init?.method === "GET")
        return jsonResponse(
          profile(["Build hiking endurance"], seededPreferences),
        );
      if (url === "/api/profile" && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        return jsonResponse({ ok: true, profile: savedBody });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    const goals = (await screen.findByLabelText(
      "Goals",
    )) as HTMLTextAreaElement;

    await waitFor(() => expect(goals.disabled).toBe(false));
    fireEvent.change(goals, {
      target: { value: "Updated endurance goal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    fireEvent.click(screen.getByText("Current operation"));

    await waitFor(() => {
      expect(screen.getByText(/Profile: saved to local SQLite/)).toBeTruthy();
    });
    expect(savedBody).toMatchObject({
      goals: ["Updated endurance goal"],
      preferences: seededPreferences,
    });
  });
});

describe("TrainerDashboard memory and new chat", () => {
  it("renders pending and confirmed memory controls", async () => {
    let patchedBody: unknown;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory" && init?.method === "PATCH") {
        patchedBody = JSON.parse(String(init.body));
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      }
      if (url === "/api/memory")
        return jsonResponse({
          memories: [
            {
              id: "memory-pending",
              category: "learned_preference",
              value: "Prefers morning hikes",
              status: "pending_confirmation",
              provenanceText: "User explicitly asked to remember.",
              expiresAt: null,
              reconfirmAfter: null,
              createdAt: "2026-07-17T12:00:00Z",
              updatedAt: "2026-07-17T12:00:00Z",
            },
            {
              id: "memory-confirmed",
              category: "learned_preference",
              value: "Likes easy recovery rides",
              status: "confirmed",
              provenanceText: "User approved memory.",
              expiresAt: null,
              reconfirmAfter: null,
              createdAt: "2026-07-17T12:00:00Z",
              updatedAt: "2026-07-17T12:00:00Z",
            },
          ],
          pending: [{ id: "memory-pending" }],
          confirmed: [{ id: "memory-confirmed" }],
        });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();

    expect(await screen.findByText("Learned memories")).toBeTruthy();
    expect(screen.getByText("Prefers morning hikes")).toBeTruthy();
    expect(screen.getByText("Likes easy recovery rides")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(patchedBody).toMatchObject({
        id: "memory-pending",
        action: "approve",
      }),
    );
  });

  it("starts a manual new chat without replaying the visible transcript", async () => {
    let postedBody: { conversationId?: string } | undefined;
    const initialMessages = [
      {
        id: "assistant-old",
        role: "assistant",
        content: "Old visible transcript",
        createdAt: "2026-07-17T12:00:00Z",
      },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url.startsWith("/api/chat") && init?.method === "POST") {
        postedBody = JSON.parse(String(init.body));
        return jsonResponse({
          conversationId: postedBody?.conversationId,
          messages: [
            {
              id: "user-new",
              role: "user",
              content: "Fresh question",
              createdAt: "2026-07-17T12:01:00Z",
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/chat"))
        return jsonResponse({ ...emptyChat, messages: initialMessages });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Old visible transcript")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => {
      expect(screen.queryByText("Old visible transcript")).toBeNull();
    });

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Fresh question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(postedBody?.conversationId).toMatch(/^local-/);
    });
  });
});

describe("TrainerDashboard transcript scrolling", () => {
  it("does not yank passive history reloads when the user has scrolled up", async () => {
    const initialMessages = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Initial local answer",
        createdAt: "2026-07-17T12:00:00Z",
      },
    ];
    const reloadedMessages = [
      ...initialMessages,
      {
        id: "assistant-2",
        role: "assistant",
        content: "Passive later answer",
        createdAt: "2026-07-17T12:01:00Z",
      },
    ];
    let chatGets = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/chat")) {
        chatGets += 1;
        return jsonResponse({
          ...emptyChat,
          messages: chatGets === 1 ? initialMessages : reloadedMessages,
          contextWindow: chatGets === 1 ? 1 : 2,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Initial local answer")).toBeTruthy();
    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTop: 100,
    });
    fireEvent.scroll(transcript);

    fireEvent.click(screen.getByRole("button", { name: "Reload history" }));

    expect(await screen.findByText("Passive later answer")).toBeTruthy();
    expect(transcript.scrollTop).toBe(100);
  });

  it("forces the latest turn into view when the user sends a message", async () => {
    const responseMessages = [
      {
        id: "user-1",
        role: "user",
        content: "What should I do tomorrow?",
        createdAt: "2026-07-17T12:00:00Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Take an easy aerobic day.",
        createdAt: "2026-07-17T12:00:30Z",
      },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/chat") && init?.method === "POST")
        return jsonResponse({ ...emptyChat, messages: responseMessages });
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTop: 100,
    });
    fireEvent.scroll(transcript);

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What should I do tomorrow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Take an easy aerobic day.")).toBeTruthy();
    await waitFor(() => expect(transcript.scrollTop).toBe(1000));
  });
});
