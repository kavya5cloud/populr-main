import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { issuerFor, redirectLabel } from "@/lib/oauth/core";
import { checkAuthorize, type AuthorizeParams } from "@/lib/oauth/service";
import { oauthStore } from "@/lib/oauth/store";
import Consent from "./Consent";

// /oauth/authorize — "Allow <editor> to use Populr?"
//
// An editor opens this when it connects to Populr's MCP server without a key. A bad client or
// a redirect address it didn't register gets an error here and is never redirected to; any
// other mistake in the request goes back to the (verified) client as an OAuth error.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect to Populr", robots: { index: false, follow: false } };

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params: AuthorizeParams = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const issuer = issuerFor(host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : undefined);
  const check = await checkAuthorize(params, oauthStore(), Date.now(), undefined, issuer);
  if (!check.ok && "redirect" in check) redirect(check.redirect);

  return (
    <div className="dv">
      <main className="oa">
        <a href="/" className="ck-logo">Populr<span>.</span></a>
        {!check.ok ? (
          <section className="oa-card">
            <h1>This connection can&apos;t continue</h1>
            <p className="oa-lead">{check.show}</p>
            <a className="ck-btn" href="/developers/docs#connect">Setup guide</a>
          </section>
        ) : (
          <Consent clientName={check.client.name} returnsTo={redirectLabel(check.redirectUri)} params={params} />
        )}
      </main>
    </div>
  );
}
