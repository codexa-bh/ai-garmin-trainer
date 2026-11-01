"use client";

import { useState } from "react";

// undefined: unresolved, null: resolved empty, string: selected. Persistence and
// request ordering belong to the persistent chat owner, not browser storage.
export function useActiveConversation() {
  return useState<string | null | undefined>(undefined);
}
