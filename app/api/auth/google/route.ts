import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { baseUrl } from "@/lib/base-url";
import { safeNext } from "@/lib/auth-next";

export const runtime = "nodejs";

function configured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export async function GET(req: NextRequest) {
  const origin = baseUrl(req);
  if (!configured()) return NextResponse.redirect(origin + "/app?auth=unavailable");

  const state = crypto.randomUUID();
  const c = await cookies();
  c.set("oauth_login_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  // Where to return after signing in (e.g. the keys page). Only a path on this site.
  c.set("oauth_login_next", safeNext(req.nextUrl.searchParams.get("next")), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: origin + "/api/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
}
