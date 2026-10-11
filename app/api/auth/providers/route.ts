import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Which "Continue with …" buttons the sign-in dialog shows.
//
// Only providers that have a sign-in route here. X and Facebook credentials can be set for
// publishing to those networks — and reporting them as sign-in options put a "Continue with X"
// button on the dialog that led to a 404. They're off until /api/auth/x and /api/auth/facebook
// exist.
const HAS_SIGN_IN_ROUTE = { google: true, facebook: false, x: false } as const;

export async function GET() {
  return NextResponse.json({
    google: HAS_SIGN_IN_ROUTE.google && !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    facebook: HAS_SIGN_IN_ROUTE.facebook && !!(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET),
    x: HAS_SIGN_IN_ROUTE.x && !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
  });
}
