"use client";

import { workspaceId } from "@/lib/store";
import type { WorkspaceProfile } from "@/lib/creative/studio-brief";

// What the studio already knows, fetched once per page load.
//
// The Composer mounts on five routes, and on /studio/create it remounts on every card
// click (Studio keys it on the pick). Each mount used to fire its own
// /api/social/dashboard request, so clicking through eight cards produced eight identical
// calls. These are module-level promises: the first caller starts the request, everyone
// after it awaits the same one, and a remount costs nothing.
//
// Deliberately not a React context or a store. Nothing here is mutable state — it is two
// read-only facts about the workspace, and a promise cache is the smallest thing that
// stops the duplication without adding a provider tree.

let accountsPromise: Promise<string[]> | null = null;
let profilePromise: Promise<WorkspaceProfile | null> | null = null;

/** Platforms with a connected account. Empty on any failure — never throws. */
export function connectedPlatforms(): Promise<string[]> {
  accountsPromise ??= fetch("/api/social/dashboard")
    .then((r) => r.json())
    .then((d) => {
      if (!d?.ok) return [];
      const accounts = d.accounts as { platform: string; status: string }[];
      return [...new Set(accounts.filter((a) => a.status === "connected").map((a) => a.platform))];
    })
    .catch(() => []);
  return accountsPromise;
}

/** The analysed business, or null for a workspace that has never been analysed. */
export function workspaceProfile(): Promise<WorkspaceProfile | null> {
  profilePromise ??= fetch(`/api/state?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
    .then((r) => r.json())
    .then((d) => (d?.state?.profile as WorkspaceProfile | undefined) ?? null)
    .catch(() => null);
  return profilePromise;
}

/** Tests, and any place that genuinely needs to re-read after a change. */
export function resetWorkspaceContext(): void {
  accountsPromise = null;
  profilePromise = null;
}
