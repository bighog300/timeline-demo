import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(() => ({})),
}));

vi.mock('../../lib/appDriveFolder', () => ({
  resolveOrProvisionAppDriveFolder: vi.fn(),
  AppDriveFolderResolveError: class AppDriveFolderResolveError extends Error {},
}));

vi.mock('../../lib/adminSettingsDrive', () => ({
  readAdminSettingsFromDrive: vi.fn(),
}));

vi.mock('../../lib/chatContext', async () => {
  const actual = await vi.importActual<typeof import('../../lib/chatContext')>(
    '../../lib/chatContext',
  );
  return {
    ...actual,
    buildContextPack: vi.fn(),
  };
});

import { readAdminSettingsFromDrive } from '../../lib/adminSettingsDrive';
import { resolveOrProvisionAppDriveFolder } from '../../lib/appDriveFolder';
import { buildContextPack } from '../../lib/chatContext';
import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockReadAdminSettingsFromDrive = vi.mocked(readAdminSettingsFromDrive);
const mockBuildContextPack = vi.mocked(buildContextPack);
const mockResolveOrProvisionAppDriveFolder = vi.mocked(resolveOrProvisionAppDriveFolder);

describe('POST /api/chat', () => {
  it('returns reconnect_required when unauthenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello there' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'reconnect_required', message: 'Reconnect required.' },
      error_code: 'reconnect_required',
      requestId: expect.any(String),
    });
  });

  it('returns reconnect_required when drive folder is missing', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: null } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue(null);

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello there' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'reconnect_required', message: 'Reconnect required.' },
      error_code: 'reconnect_required',
      requestId: expect.any(String),
    });
  });

  it('returns citations and provider metadata for stub provider', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'person@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'Timeline Demo (App Data)',
    });
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        type: 'admin_settings',
        version: 1,
        provider: 'stub',
        model: 'stub',
        systemPrompt: '',
        maxContextItems: 8,
        temperature: 0.2,
        updatedAtISO: '2024-01-01T00:00:00.000Z',
      },
      fileId: undefined,
      webViewLink: undefined,
    });
    mockBuildContextPack.mockResolvedValue({
      items: [
        {
          artifactId: 'summary-1',
          title: 'Launch Plan',
          dateISO: '2024-01-02T00:00:00.000Z',
          snippet: 'Launch plan summary.',
          kind: 'summary',
        },
      ],
      debug: { usedIndex: true, totalConsidered: 1 },
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'What have I covered recently?' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: Array<{ artifactId: string; title: string }>;
      provider: { name: string; model: string };
      requestId: string;
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('[stub:');
    expect(payload.citations).toEqual([
      {
        artifactId: 'summary-1',
        title: 'Launch Plan',
        dateISO: '2024-01-02T00:00:00.000Z',
        kind: 'summary',
      },
    ]);
    expect(payload.provider).toEqual({ name: 'stub', model: 'stub' });
    expect(payload.requestId).toEqual(expect.any(String));
  });

  it('falls back to stub when provider key is missing for non-admins', async () => {
    delete process.env.OPENAI_API_KEY;
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'person@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'Timeline Demo (App Data)',
    });
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        type: 'admin_settings',
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        maxContextItems: 8,
        temperature: 0.2,
        updatedAtISO: '2024-01-01T00:00:00.000Z',
      },
      fileId: undefined,
      webViewLink: undefined,
    });
    mockBuildContextPack.mockResolvedValue({
      items: [
        {
          artifactId: 'summary-1',
          title: 'Launch Plan',
          dateISO: '2024-01-02T00:00:00.000Z',
          snippet: 'Launch plan summary.',
          kind: 'summary',
        },
      ],
      debug: { usedIndex: true, totalConsidered: 1 },
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Status update' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      provider: { name: string; model: string };
    };

    expect(response.status).toBe(200);
    expect(payload.provider).toEqual({ name: 'stub', model: 'stub' });
    expect(payload.reply).toContain('[stub:');
  });
});
