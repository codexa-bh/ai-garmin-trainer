"use client";

import { type ReactNode, useEffectEvent, useLayoutEffect, useRef } from "react";

/** Native top-layer modality keeps navigation above the transcript and header. */
export function MobileNavigationSheet({
  open,
  onDismiss,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  const dismissOnResize = useEffectEvent(onDismiss);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const root = document.documentElement;
    const body = document.body;
    const rootOverflow = root.style.overflow;
    const bodyOverflow = body.style.overflow;
    dialog.showModal();
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    dialog.querySelector<HTMLButtonElement>("button")?.focus();

    function handleResize() {
      if (window.matchMedia("(min-width: 641px)").matches) {
        dialog?.close();
        dismissOnResize();
      }
    }
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      dialog.close();
      root.style.overflow = rootOverflow;
      body.style.overflow = bodyOverflow;
      backdropPointerDown.current = false;
    };
  }, [open]);

  function dismiss() {
    dialogRef.current?.close();
    onDismiss();
  }

  return (
    <dialog
      ref={dialogRef}
      id="app-main-menu"
      className="app-menu-dialog"
      aria-label="Main menu"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
        if (event.key !== "Tab") return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onPointerDown={(event) => {
        backdropPointerDown.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          backdropPointerDown.current
        ) {
          dismiss();
        }
        backdropPointerDown.current = false;
      }}
    >
      <div className="app-menu-panel">
        <div className="app-menu-heading">
          <h2>Navigation</h2>
          <button type="button" className="chrome-button" onClick={dismiss}>
            Close
          </button>
        </div>
        <nav
          aria-label="Mobile navigation"
          onClickCapture={(event) => {
            // Release native modality before the shell focuses a destination.
            if (
              event.target instanceof Element &&
              event.target.closest("button:not(:disabled)")
            ) {
              dialogRef.current?.close();
            }
          }}
        >
          {children}
        </nav>
      </div>
    </dialog>
  );
}
