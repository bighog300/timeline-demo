import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { NextResponse } from "next/server";
import type { NextAuthOptions } from "next-auth";
import { isAuthConfigured } from "@/app/lib/googleAuth";

export const runtime = "nodejs";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // If you use custom params/scopes in your repo, keep them here.
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  // In Vercel, trustHost avoids host/header issues
  trustHost: true,
};

const nextAuthHandler = NextAuth(authOptions);

export async function GET(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  // NextAuth route handler in App Router
  return nextAuthHandler(req as any);
}

export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  return nextAuthHandler(req as any);
}
