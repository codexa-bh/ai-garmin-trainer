"use client";

import { useSyncExternalStore } from "react";

const storageKey = "trainer.activeConversationId";
const changeEvent = "trainer:active-conversation";

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  return () => window.removeEventListener(changeEvent, onChange);
}

function readConversation() {
  return window.localStorage.getItem(storageKey) || "default";
}

function serverConversation() {
  return "default";
}

function selectConversation(id: string) {
  window.localStorage.setItem(storageKey, id);
  window.dispatchEvent(new Event(changeEvent));
}

// Hydration reads the existing browser selection without an effect-driven state
// copy or overwriting storage with the server's default. Deliberately tab-local.
export function useActiveConversation() {
  const id = useSyncExternalStore(
    subscribe,
    readConversation,
    serverConversation,
  );
  return [id, selectConversation] as const;
}
