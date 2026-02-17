import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/adminSettingsDrive', () => ({
  readAdminSettingsFromDrive: vi.fn(),
}));

vi.mock('../../../../lib/llm/providerRouter', () => ({
  getTimelineProviderForSettings: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { ProviderError } from '../../../../lib/llm/providerErrors';
import { getTimelineProviderForSettings } from '../../../../lib/llm/providerRouter';
import { readAdminSettingsFromDrive } from '../../../../lib/adminSettingsDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockReadAdminSettingsFromDrive = vi.mocked(readAdminSettingsFromDrive);
const mockGetTimelineProviderForSettings = vi.mocked(getTimelineProviderForSettings);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAILS = 'admin@example.com';
  mockGetGoogleAccessToken.mockResolvedValue('token');
  mockCreateDriveClient.mockReturnValue({} as never);
  mockReadAdminSettingsFromDrive.mockResolvedValue({
    settings: {
      type: 'admin_settings',
      version: 1,
      provider: 'stub',
      model: 'stub-model',
      systemPrompt: '',
      summaryPromptTemplate: '',
      highlightsPromptTemplate: '',
      maxOutputTokens: 100,
      maxContextItems: 4,
      temperature: 0.2,
      updatedAtISO: new Date().toISOString(),
    },
  } as never);
});

describe('POST /api/admin/provider/test', () => {
  it('returns 403 for non-admin users', async () => {
    mockGetGoogleSession.mockResolvedValue({
      user: { email: 'user@example.com' },
      driveFolderId: 'folder-1',
    } as never);

    const response = await POST(new Request('http://localhost/api/admin/provider/test', { method: 'POST', body: '{}' }) as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'forbidden' });
  });

  it('returns 400 for invalid body', async () => {
    mockGetGoogleSession.mockResolvedValue({
      user: { email: 'admin@example.com' },
      driveFolderId: 'folder-1',
    } as never);

    const response = await POST(
      new Request('http://localhost/api/admin/provider/test', {
        method: 'POST',
        body: JSON.stringify({ maxOutputTokens: 'nope' }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'bad_request' });
  });

  it('returns provider_not_configured when openai key is missing', async () => {
    mockGetGoogleSession.mockResolvedValue({
      user: { email: 'admin@example.com' },
      driveFolderId: 'folder-1',
    } as never);

    mockGetTimelineProviderForSettings.mockImplementation(() => {
      throw new ProviderError({
        code: 'not_configured',
        status: 500,
        provider: 'openai',
        message: 'Provider not configured.',
      });
    });

    const response = await POST(
      new Request('http://localhost/api/admin/provider/test', {
        method: 'POST',
        body: JSON.stringify({ provider: 'openai' }),
      }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'provider_not_configured' });
  });

  it('returns parsed summary/highlights for stub provider', async () => {
    mockGetGoogleSession.mockResolvedValue({
      user: { email: 'admin@example.com' },
      driveFolderId: 'folder-1',
    } as never);

    mockGetTimelineProviderForSettings.mockReturnValue({
      summarize: vi.fn().mockResolvedValue({
        summary: 'Test summary',
        highlights: ['A', 'B'],
        model: 'stub-model',
      }),
    } as never);

    const response = await POST(
      new Request('http://localhost/api/admin/provider/test', {
        method: 'POST',
        body: JSON.stringify({ provider: 'stub' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: 'stub',
      summary: 'Test summary',
      highlights: ['A', 'B'],
    });
  });
});
