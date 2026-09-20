/** @vitest-environment jsdom */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNavigationSheet } from "../src/app/mobile-navigation-sheet";
import { stubNativeDialog } from "./native-dialog-stub";

beforeEach(stubNativeDialog);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

function Sheet({ onDismiss = vi.fn() }: { onDismiss?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Menu
      </button>
      <MobileNavigationSheet
        open={open}
        onDismiss={() => {
          setOpen(false);
          trigger.current?.focus();
          onDismiss();
        }}
      >
        <button>Activities</button>
        <button disabled>Disabled</button>
        <button>Settings</button>
      </MobileNavigationSheet>
    </>
  );
}

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  return screen.getByRole("dialog", { name: "Main menu" });
}

describe("mobile navigation sheet lifecycle", () => {
  it("enters focus, wraps Tab in both directions and restores scroll on repeated cancellation", () => {
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "scroll";
    render(<Sheet />);
    for (let cycle = 0; cycle < 2; cycle++) {
      const dialog = openSheet();
      const close = within(dialog).getByRole("button", { name: "Close" });
      const last = within(dialog).getByRole("button", { name: "Settings" });
      expect(document.activeElement).toBe(close);
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.documentElement.style.overflow).toBe("hidden");
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
      fireEvent.keyDown(last, { key: "Tab" });
      expect(document.activeElement).toBe(close);
      fireEvent.click(close);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Menu" }),
      );
      expect(document.body.style.overflow).toBe("auto");
      expect(document.documentElement.style.overflow).toBe("scroll");
    }
  });

  it("distinguishes backdrop clicks from inside clicks and drags", () => {
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const dialog = openSheet();
    const heading = within(dialog).getByRole("heading", { name: "Navigation" });
    fireEvent.pointerDown(heading);
    fireEvent.click(heading);
    fireEvent.pointerDown(heading);
    fireEvent.click(dialog);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("contains Escape so it cannot cascade to the shell and handles native cancel", () => {
    const outerEscape = vi.fn();
    window.addEventListener("keydown", outerEscape);
    render(<Sheet />);
    let dialog = openSheet();
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Close" }), {
      key: "Escape",
    });
    expect(outerEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = openSheet();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    window.removeEventListener("keydown", outerEscape);
  });

  it("releases native modality before navigation dispatch", () => {
    let wasModalAtSelection = true;
    render(
      <MobileNavigationSheet open onDismiss={vi.fn()}>
        <button
          onClick={() => {
            wasModalAtSelection = (
              document.querySelector("dialog") as HTMLDialogElement
            ).open;
          }}
        >
          Training Plan
        </button>
      </MobileNavigationSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Training Plan" }));
    expect(wasModalAtSelection).toBe(false);
  });

  it("closes past the mobile breakpoint and cleans up on unmount", () => {
    let wide = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: wide })),
    );
    const onDismiss = vi.fn();
    const { unmount } = render(<Sheet onDismiss={onDismiss} />);
    openSheet();
    fireEvent(window, new Event("resize"));
    expect(onDismiss).not.toHaveBeenCalled();
    wide = true;
    fireEvent(window, new Event("resize"));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("");
    openSheet();
    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
    fireEvent(window, new Event("resize"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
