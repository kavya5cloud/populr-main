import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { ASSET_KINDS, type AssetKind } from "@/lib/creative/taxonomy";
import { normalizeBrief } from "@/lib/creative/pipeline";
import { ContentStudio } from "@/lib/content/studio";
import { aiGate } from "@/lib/billing/meter";

export const runtime = "nodejs";

// Content generation — the one entry point for producing an asset. Populr plans the
// spec, the router picks a provider (with fallback + caching), the Council evaluates,
// and the result is stored in the Asset Graph + History + Media Library. The caller
// never names a provider.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const denied = await aiGate(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const kind = String(body.kind || "");
  if (!(ASSET_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "invalid_kind", hint: `kind must be one of the ${ASSET_KINDS.length} asset kinds` }, { status: 422 });
  }
  const key = await workspaceKey((body.wsid as string) ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const brief = normalizeBrief((body.brief ?? {}) as Record<string, unknown>);
  const dryRun = body.dryRun === true;
  const sql = dryRun ? null : db();

  try {
    const studio = new ContentStudio({ workspaceKey: key, sql });
    const result = await studio.generate({
      kind: kind as AssetKind,
      brief,
      mission: typeof body.mission === "string" ? body.mission : undefined,
      campaignId: typeof body.campaignId === "string" ? body.campaignId : null,
      instruction: typeof body.instruction === "string" ? body.instruction : undefined,
      hints: (body.hints && typeof body.hints === "object" ? body.hints : {}) as Record<string, unknown>,
      constraints: (body.constraints && typeof body.constraints === "object" ? body.constraints : undefined) as { minQuality?: number; maxCredits?: number; preferProviderId?: string } | undefined,
      dryRun,
    });
    console.info(JSON.stringify({
      event: "content_generate", kind, provider: result.result.providerId,
      approval: result.approval, cached: result.result.cached, cost: result.result.cost.credits,
    }));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.info(JSON.stringify({ event: "content_generate_error", detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "generate_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
