import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/googleGmail', () => ({
  createGmailClient: vi.fn(),
}));

vi.mock('../../../lib/fetchSourceText', () => ({
  fetchGmailMessageText: vi.fn(),
  fetchDriveFileText: vi.fn(),
}));

vi.mock('../../../lib/summarize', () => ({
  summarizeDeterministic: vi.fn(),
}));

vi.mock('../../../lib/writeArtifactToDrive', () => ({
  writeArtifactToDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { summarizeDeterministic } from '../../../lib/summarize';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockCreateGmailClient = vi.mocked(createGmailClient);
const mockFetchGmailMessageText = vi.mocked(fetchGmailMessageText);
const mockSummarizeDeterministic = vi.mocked(summarizeDeterministic);
const mockWriteArtifactToDrive = vi.mocked(writeArtifactToDrive);

describe('POST /api/timeline/summarize', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await POST(new Request('http://localhost/api/timeline/summarize') as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'reconnect_required',
        message: 'Reconnect required.',
      },
      error_code: 'reconnect_required',
    });
  });

  it('returns drive_not_provisioned when session has no folder', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: undefined } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize', {
        method: 'POST',
        body: JSON.stringify({ items: [{ source: 'gmail', id: 'id-1' }] }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'drive_not_provisioned',
        message: 'Drive folder not provisioned.',
      },
      error_code: 'drive_not_provisioned',
    });
  });

  it('returns too_many_items when over the cap', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize', {
        method: 'POST',
        body: JSON.stringify({
          items: Array.from({ length: 11 }, (_, index) => ({
            source: 'gmail',
            id: `id-${index}`,
          })),
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'too_many_items',
        message: 'Too many items requested.',
        details: {
          limit: 10,
        },
      },
      error_code: 'too_many_items',
    });
  });

  it('returns summary artifacts with the JSON drive file id', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockCreateGmailClient.mockReturnValue({} as never);
    mockFetchGmailMessageText.mockResolvedValue({
      title: 'Demo',
      text: 'Hello world',
      metadata: { subject: 'Demo subject' },
    });
    mockSummarizeDeterministic.mockResolvedValue({
      summary: 'Summary text',
      highlights: ['Point A'],
    });
    mockWriteArtifactToDrive.mockResolvedValue({
      markdownFileId: 'md-1',
      markdownWebViewLink: 'https://drive.google.com/md-1',
      jsonFileId: 'json-1',
      jsonWebViewLink: 'https://drive.google.com/json-1',
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize', {
        method: 'POST',
        body: JSON.stringify({ items: [{ source: 'gmail', id: 'id-1' }] }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0].driveFileId).toBe('json-1');
    expect(payload.artifacts[0].driveWebViewLink).toBe('https://drive.google.com/json-1');
    expect(mockWriteArtifactToDrive).toHaveBeenCalledWith(
      expect.any(Object),
      'folder-1',
      expect.objectContaining({
        source: 'gmail',
        sourceId: 'id-1',
      }),
      expect.any(Object),
    );
  });
});
