import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { encode, getToken } from 'next-auth/jwt';
import type { NextRequest, NextResponse } from 'next/server';

const DEFAULT_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

export const GOOGLE_SCOPES = process.env.GOOGLE_SCOPES ?? DEFAULT_GOOGLE_SCOPES;
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.scopes = account.scope?.split(' ').filter(Boolean) ?? [];
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined;
        token.lastTokenRefresh = new Date().toISOString();
      }

      return token;
    },
    async session({ session, token }) {
      session.accessToken = typeof token.accessToken === 'string' ? token.accessToken : undefined;
      session.scopes = Array.isArray(token.scopes) ? token.scopes : [];
      session.lastTokenRefresh =
        typeof token.lastTokenRefresh === 'string' ? token.lastTokenRefresh : undefined;
      session.driveFolderId =
        typeof token.driveFolderId === 'string' ? token.driveFolderId : undefined;
      return session;
    },
  },
};

export const isAuthConfigured = () =>
  Boolean(process.env.NEXTAUTH_SECRET && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const getGoogleSession = async () => {
  if (!isAuthConfigured()) {
    return null;
  }

  return getServerSession(authOptions);
};

export const getGoogleAccessToken = async () => {
  const session = await getGoogleSession();
  return session?.accessToken ?? null;
};

export const getSessionCookieName = () => {
  const isSecure =
    process.env.NEXTAUTH_URL?.startsWith('https://') || process.env.NODE_ENV === 'production';
  return isSecure ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
};

export const persistDriveFolderId = async (
  request: NextRequest,
  response: NextResponse,
  folderId: string,
) => {
  if (!process.env.NEXTAUTH_SECRET) {
    return;
  }

  const isSecure =
    process.env.NEXTAUTH_URL?.startsWith('https://') || process.env.NODE_ENV === 'production';
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: isSecure,
  });

  if (!token) {
    return;
  }

  const updatedToken = { ...token, driveFolderId: folderId };
  const encodedToken = await encode({
    token: updatedToken,
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  response.cookies.set(getSessionCookieName(), encodedToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
};
