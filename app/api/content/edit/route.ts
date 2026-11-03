import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { ASSET_KINDS, type AssetKind } from "@/lib/creative/taxonomy";
import { normalizeBrief } from "@/lib/creative/pipeline";
import { GenerationRouter } from "@/lib/content/router";
import { getRegistry } from "@/lib/content/registry";
import { buildSpec } from "@/lib/content/pipeline";
import type { ProviderOutput } from "@/lib/content/types";
import { aiGate } from "@/lib/billing/meter";

export const runtime = "nodejs";

// Content edit — modify a prior output through the router. Routes to a provider that
// supports editing (preferring the original), with fallback. Vendor-neutral.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const denied = await aiGate(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const kind = String(body.kind || "");
  if (!(ASSET_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "invalid_kind" }, { status: 422 });
  const instruction = String(body.instruction || "").trim();
  if (!instruction) return NextResponse.json({ error: "missing_instruction" }, { status: 422 });
  const key = await workspaceKey((body.wsid as string) ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const brief = normalizeBrief((body.brief ?? {}) as Record<string, unknown>);
  const base = (body.base && typeof body.base === "object" ? body.base : {}) as ProviderOutput;

  try {
    const spec = buildSpec({ kind: kind as AssetKind, brief, hints: (body.hints as Record<string, unknown>) ?? {} });
    const router = new GenerationRouter({ registry: getRegistry() });
    const result = await router.edit(
      { spec, constraints: (body.constraints as { preferProviderId?: string }) ?? undefined },
      instruction,
      base
    );
    console.info(JSON.stringify({ event: "content_edit", kind, provider: result.providerId }));
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: "edit_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
