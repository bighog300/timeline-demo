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

vi.mock('../../../lib/llm/providerRouter', () => ({
  getTimelineProviderFromDrive: vi.fn(),
}));

vi.mock('../../../lib/writeArtifactToDrive', () => ({
  writeArtifactToDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockCreateGmailClient = vi.mocked(createGmailClient);
const mockFetchGmailMessageText = vi.mocked(fetchGmailMessageText);
const mockGetTimelineProviderFromDrive = vi.mocked(getTimelineProviderFromDrive);
const mockWriteArtifactToDrive = vi.mocked(writeArtifactToDrive);

describe('POST /api/timeline/summarize', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await POST(new Request('http://localhost/api/timeline/summarize') as never);

    expect(response.status).toBe(401);
  });

  it('returns provider_not_configured when provider credentials are missing', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockCreateGmailClient.mockReturnValue({} as never);
    mockGetTimelineProviderFromDrive.mockRejectedValue(
      new ProviderError({
        code: 'not_configured',
        status: 500,
        provider: 'openai',
        message: 'Provider not configured.',
      }),
    );

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize', {
        method: 'POST',
        body: JSON.stringify({ items: [{ source: 'gmail', id: 'id-1' }] }),
      }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'provider_not_configured' });
  });

  it('returns provider_bad_output when provider output is malformed', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockCreateGmailClient.mockReturnValue({} as never);
    mockFetchGmailMessageText.mockResolvedValue({ title: 'Demo', text: 'Hello', metadata: {} });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'openai', model: 'gpt-4o-mini' },
      provider: {
        summarize: vi.fn().mockRejectedValue(
          new ProviderError({
            code: 'bad_output',
            status: 502,
            provider: 'timeline',
            message: 'bad output',
          }),
        ),
      },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize', {
        method: 'POST',
        body: JSON.stringify({ items: [{ source: 'gmail', id: 'id-1' }] }),
      }) as never,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'provider_bad_output' });
  });

  it('returns summary artifacts with selected provider model', async () => {
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
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub-model' },
      provider: {
        summarize: vi.fn().mockResolvedValue({
          summary: 'Summary text',
          highlights: ['Point A'],
          model: 'stub-model',
        }),
      },
    } as never);
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
    expect(payload.artifacts[0].model).toBe('stub-model');
  });
});
