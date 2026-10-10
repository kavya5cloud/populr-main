import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { marketPlatform } from "@/lib/market/shared";
import { scrubIdentity } from "@/lib/cmo/identity";
import { runResearch, type ResearchEvent } from "@/lib/agents/live/research";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/agents/research — the research and strategy agents, live.
//
// Streams newline-delimited JSON, one event per line, as each step starts and finishes, so
// the chat shows the work happening rather than a spinner for twenty seconds. The request's
// own abort signal reaches every network call: a founder who closes the tab stops the
// research and the model call, rather than leaving them running and billed.

export async function POST(req: NextRequest) {
  const session = await getSession();
  // Live research costs real requests to real services; it gets a tighter limit than chat.
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 12 : 4, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  let body: { wsid?: string; question?: string; profile?: { name?: string; oneLiner?: string; audience?: string; competitors?: string[] } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tenant = await workspaceKey(body.wsid ?? null);
  if (!tenant) return NextResponse.json({ error: "no_key" }, { status: 400 });
  const question = String(body.question || "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ error: "empty_question" }, { status: 400 });

  const p = body.profile ?? {};
  const brand = {
    name: p.name?.slice(0, 80), oneLiner: p.oneLiner?.slice(0, 300), audience: p.audience?.slice(0, 200),
    competitors: Array.isArray(p.competitors) ? p.competitors.slice(0, 4).map((c) => String(c).slice(0, 200)) : [],
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ResearchEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        for await (const e of runResearch({ tenant, question, brand }, { aggregator: marketPlatform().aggregator, signal: req.signal })) {
          // The CMO never names the model behind it, in research answers as everywhere else.
          send(e.type === "answer" ? { ...e, text: scrubIdentity(e.text).text } : e);
        }
      } catch {
        send({ type: "answer", text: "Something went wrong while researching that. Try again in a moment." });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
