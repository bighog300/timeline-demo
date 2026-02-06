import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';

export const createGmailClient = (accessToken: string): gmail_v1.Gmail => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
};
