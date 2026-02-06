import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    scopes?: string[];
    lastTokenRefresh?: string;
    driveFolderId?: string;
    user?: DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    scopes?: string[];
    accessTokenExpires?: number;
    lastTokenRefresh?: string;
    driveFolderId?: string;
  }
}
