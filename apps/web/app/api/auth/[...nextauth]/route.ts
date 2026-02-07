import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { NextResponse } from "next/server";
import type { NextAuthOptions } from "next-auth";
import { isAuthConfigured } from "../../../lib/googleAuth";

export const runtime = "nodejs";

// IMPORTANT: do NOT export authOptions from an App Router route module.
// Next.js will fail the build if you export non-route fields.
const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  // In Vercel, trustHost avoids host/header issues
  trustHost: true,
};

const handler = NextAuth(authOptions);

export async function GET(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  return handler(req as any);
}

export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  return handler(req as any);
}
