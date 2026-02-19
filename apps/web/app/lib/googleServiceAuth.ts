import { getAdminEmailList } from './adminAuth';

type ServiceAuthErrorCode = 'missing_refresh_token' | 'token_refresh_failed' | 'missing_client_credentials';

export type ServiceAuthResult =
  | { ok: true; accessToken: string; expiresAtISO?: string }
  | { ok: false; error: ServiceAuthErrorCode; details?: string };

const loadRefreshTokenForCron = async (): Promise<string | null> => {
  if (process.env.GOOGLE_ADMIN_REFRESH_TOKEN?.trim()) {
    return process.env.GOOGLE_ADMIN_REFRESH_TOKEN.trim();
  }

  const adminEmails = getAdminEmailList();
  if (adminEmails.length === 0) {
    return null;
  }

  return null;
};

export const refreshGoogleAccessToken = async (refreshToken: string): Promise<ServiceAuthResult> => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return { ok: false, error: 'missing_client_credentials' };
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    return { ok: false, error: 'token_refresh_failed', details: `status_${response.status}` };
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    return { ok: false, error: 'token_refresh_failed', details: 'missing_access_token' };
  }

  return {
    ok: true,
    accessToken: payload.access_token,
    expiresAtISO:
      typeof payload.expires_in === 'number'
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : undefined,
  };
};

export const getGoogleAccessTokenForCron = async (): Promise<ServiceAuthResult> => {
  const refreshToken = await loadRefreshTokenForCron();
  if (!refreshToken) {
    return { ok: false, error: 'missing_refresh_token' };
  }

  return refreshGoogleAccessToken(refreshToken);
};
