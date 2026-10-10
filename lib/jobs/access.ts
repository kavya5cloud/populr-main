import type { NextRequest } from "next/server";
import { workspaceKey } from "@/lib/intel";
import type { Job } from "./types";

// Who may see or touch a job: the workspace that created it, and nobody else.
//
// The job routes had no check at all. The dashboard listed every business's jobs to anyone —
// no login needed — and with an id from that list GET /api/jobs/{id} returned the job whole,
// another business's prompts and generated content included, while cancel/pause/retry acted
// on it. A job with no recorded owner is visible to no one: there is no safe way to guess
// whose it is.

/** The caller's workspace: the signed-in account, or the browser's workspace id. */
export async function callerWorkspace(req: NextRequest): Promise<string | null> {
  return workspaceKey(req.nextUrl.searchParams.get("wsid"));
}

export function ownsJob(job: Pick<Job, "input"> | null | undefined, workspace: string | null): boolean {
  return !!job && !!workspace && job.input.workspaceKey === workspace;
}
