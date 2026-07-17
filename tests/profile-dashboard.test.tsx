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

function profile(goals: string[] = ["Build hiking endurance"]) {
  return {
    goals,
    sports: ["hiking", "mountaineering"],
    constraints: ["no running this week"],
    preferences: { coachingStyle: "direct" },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TrainerDashboard Profile hydration", () => {
  it("loads a saved Profile on authenticated startup", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/chat") return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Goals") as HTMLTextAreaElement).value,
      ).toBe("Build hiking endurance");
    });
    expect(
      (screen.getByLabelText("Preferred sports") as HTMLTextAreaElement).value,
    ).toBe("hiking\nmountaineering");
    expect(
      (screen.getByLabelText("Preferences JSON") as HTMLTextAreaElement).value,
    ).toContain('"coachingStyle": "direct"');
  });

  it("hydrates after local sign-in when startup profile loading was unauthenticated", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/chat") return jsonResponse(emptyChat);
      if (url === "/api/dev-login" && init?.method === "POST") {
        return jsonResponse({ ok: true });
      }
      if (url === "/api/profile" && init?.method === "GET") {
        const profileGetCount = fetchMock.mock.calls.filter(
          ([calledUrl, calledInit]) =>
            String(calledUrl) === "/api/profile" &&
            calledInit?.method === "GET",
        ).length;
        if (profileGetCount === 1) {
          return jsonResponse({ error: "unauthenticated" }, { status: 401 });
        }
        return jsonResponse(profile(["Climb steady on long hikes"]));
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    await waitFor(() => {
      expect(screen.getByText("Sign in to load Profile")).toBeTruthy();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Use configured local session" }),
    );

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Goals") as HTMLTextAreaElement).value,
      ).toBe("Climb steady on long hikes");
    });
  });

  it("preserves dirty edits when a manual Profile reload returns late", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/chat") return jsonResponse(emptyChat);
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
      if (url === "/api/chat") return jsonResponse(emptyChat);
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

    await waitFor(() => {
      expect(screen.getByText("Profile: saved to local SQLite.")).toBeTruthy();
    });
    expect(savedBody).toMatchObject({
      goals: ["Summit endurance", "Easy recovery"],
      sports: ["hiking", "cycling"],
      constraints: ["no running this week"],
      preferences: {},
    });
    expect(goals.value).toBe("Summit endurance\nEasy recovery");
  });
});
