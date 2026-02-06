import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';

export const createDriveClient = (accessToken: string): drive_v3.Drive => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth });
};
