import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { AGENT_PROFILES, TEAM_ORDER } from "@/lib/agents/registry";
import { teamPlatform } from "@/lib/agents/shared";
import { lastAgentPass } from "@/lib/agents/pass-log";

export const runtime = "nodejs";

// GET /api/agents/team — the workspace's AI team, for the team dashboard.
//
// The per-launch payload (/api/agents/state) needs a launch id. The daily pass makes a fresh
// launch every run, so a founder asking "what has my team been doing" means the latest one —
// this resolves it. Everything below is derived from the stored task log by AgentBoard, so
// the page can never show a number the tasks don't support.

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 120 : 40, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!tenant) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const p = teamPlatform();
    const [state, lastPassAt] = await Promise.all([p.state.latest(tenant), lastAgentPass(tenant).catch(() => null)]);
    const roster = TEAM_ORDER.map((id) => ({ id, name: AGENT_PROFILES[id].name, role: AGENT_PROFILES[id].role, responsibilities: AGENT_PROFILES[id].responsibilities }));

    if (!state) {
      return NextResponse.json({ ok: true, ran: false, lastPassAt, roster, agents: [], completed: [], waitingApproval: [] });
    }
    return NextResponse.json({
      ok: true, ran: true, lastPassAt, roster,
      agents: p.board.summaries(state),
      totals: p.board.totals(state),
      completed: p.board.completed(state, 20),
      waitingApproval: p.board.waitingApproval(state),
    });
  } catch (e) {
    return NextResponse.json({ error: "team_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
