import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, ensureSchema } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { safeNext, signedInUrl } from "@/lib/auth-next";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const origin = baseUrl(req);
  const sql = db();
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  const c = await cookies();
  const expected = c.get("oauth_login_state")?.value;
  const next = safeNext(c.get("oauth_login_next")?.value);
  c.delete("oauth_login_state");
  c.delete("oauth_login_next");

  if (!sql) return NextResponse.redirect(origin + "/app?auth=no_db");
  if (!code || !state || state !== expected) return NextResponse.redirect(origin + "/app?auth=denied");

  try {
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: origin + "/api/auth/google/callback",
        grant_type: "authorization_code",
      }),
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return NextResponse.redirect(origin + "/app?auth=error");

    const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + tok.access_token },
    });
    const ui = await uiRes.json();
    const email = String(ui.email || "").trim().toLowerCase();
    if (!email) return NextResponse.redirect(origin + "/app?auth=noemail");

    await ensureSchema(sql);
    const rows = (await sql`SELECT id FROM users WHERE email = ${email}`) as { id: string }[];
    let userId = rows[0]?.id;
    if (!userId) {
      userId = crypto.randomUUID();
      // OAuth users have no usable password hash; password login simply won't match.
      await sql`INSERT INTO users (id, email, password_hash) VALUES (${userId}, ${email}, ${"oauth:google"})`;
    }
    await createSession(userId, email);
    return NextResponse.redirect(signedInUrl(origin, next));
  } catch {
    return NextResponse.redirect(origin + "/app?auth=error");
  }
}
