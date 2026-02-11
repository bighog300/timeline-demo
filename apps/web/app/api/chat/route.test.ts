import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(() => ({ files: { create: vi.fn().mockResolvedValue({ data: { id: 'chat-run-1' } }) } })),
}));

vi.mock('../../lib/appDriveFolder', () => ({
  resolveOrProvisionAppDriveFolder: vi.fn(),
  AppDriveFolderResolveError: class AppDriveFolderResolveError extends Error {},
}));

vi.mock('../../lib/adminSettingsDrive', () => ({
  readAdminSettingsFromDrive: vi.fn(),
}));

vi.mock('../../lib/llm/index', () => ({
  callLLM: vi.fn(),
}));

vi.mock('../../lib/originals', async () => {
  const actual = await vi.importActual<typeof import('../../lib/originals')>('../../lib/originals');
  return {
    ...actual,
    fetchOriginalTextForArtifact: vi.fn(),
  };
});

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
import { ProviderError } from '../../lib/llm/providerErrors';
import { callLLM } from '../../lib/llm/index';
import { fetchOriginalTextForArtifact, truncateOriginalText } from '../../lib/originals';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockReadAdminSettingsFromDrive = vi.mocked(readAdminSettingsFromDrive);
const mockBuildContextPack = vi.mocked(buildContextPack);
const mockResolveOrProvisionAppDriveFolder = vi.mocked(resolveOrProvisionAppDriveFolder);
const mockCallLLM = vi.mocked(callLLM);
const mockFetchOriginalTextForArtifact = vi.mocked(fetchOriginalTextForArtifact);

const defaultContextItem = {
  artifactId: 'summary-1',
  title: 'Launch Plan',
  dateISO: '2024-01-02T00:00:00.000Z',
  snippet: 'Launch plan summary.',
  kind: 'summary' as const,
  source: 'gmail' as const,
  sourceId: 'msg-1',
};

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });
    mockCallLLM.mockResolvedValue({ text: '[stub: answer]' });

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


  it('returns advisor structured headings when advisorMode is enabled with stub provider', async () => {
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
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });
    mockCallLLM.mockResolvedValue({
      text: `## Timeline summary
- Event from source [1].

## What stands out
- Pattern [1].

## Legal considerations (general information)
- This may be relevant in context [1].
- Not legal advice.

## Psychological and interpersonal signals (non-clinical)
- A communication dynamic may be present [1].
- Not a diagnosis.

## Questions to clarify
- What happened first?

## Suggested next steps
- Open original for SOURCE 1.`,
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Review this timeline', advisorMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { reply: string };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('## Timeline summary');
    expect(payload.reply).toContain('## Legal considerations (general information)');
    expect(payload.reply).toContain('## Psychological and interpersonal signals (non-clinical)');
  });


  it('includes saved search and run labels in advisor context and returns metadata citations', async () => {
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
        defaultContextItem,
        {
          kind: 'selection_set',
          id: 'set-1',
          title: 'Saved Employment Search',
          source: 'gmail',
          q: 'termination manager',
          updatedAtISO: '2024-05-01T00:00:00.000Z',
          text: 'Saved search metadata only.',
        },
        {
          kind: 'run',
          id: 'run-1',
          action: 'summarize',
          selectionSetId: 'set-1',
          selectionSetTitle: 'Saved Employment Search',
          startedAtISO: '2024-05-01T00:10:00.000Z',
          finishedAtISO: '2024-05-01T00:11:00.000Z',
          status: 'partial_success',
          foundCount: 10,
          processedCount: 8,
          failedCount: 2,
          requestIds: ['req-1'],
          text: 'Run metadata only.',
        },
      ],
      debug: { usedIndex: true, totalConsidered: 3 },
    });
    mockCallLLM.mockResolvedValue({ text: '[stub: answer]' });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'What have I worked on?', advisorMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      citations: Array<{ kind: string; title: string; selectionSetId?: string; runId?: string }>;
    };

    const firstCall = mockCallLLM.mock.calls[0]?.[1];
    const contextMessage = firstCall?.messages?.[0]?.content ?? '';

    expect(contextMessage).toContain('(SAVED SEARCH)');
    expect(contextMessage).toContain('(RUN)');
    expect(response.status).toBe(200);
    expect(payload.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'summary', title: 'Launch Plan' }),
        expect.objectContaining({ kind: 'selection_set', selectionSetId: 'set-1' }),
        expect.objectContaining({ kind: 'run', runId: 'run-1' }),
      ]),
    );
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
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });
    mockCallLLM
      .mockRejectedValueOnce(new ProviderError({ code: 'not_configured', status: 400, provider: 'openai', message: 'Provider not configured.' }))
      .mockResolvedValueOnce({ text: '[stub: fallback]' });

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




  it('maps provider invalid_request errors to 400 with safe details and request id header', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'person@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({ id: 'folder-1' } as never);
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: '',
      },
    } as never);
    mockBuildContextPack.mockResolvedValue({
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });
    mockCallLLM.mockRejectedValueOnce(
      new ProviderError({
        code: 'invalid_request',
        status: 400,
        provider: 'openai',
        message: 'invalid request',
        details: {
          providerStatus: 400,
          providerMessage: 'x'.repeat(300),
        },
      }),
    );

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Status update' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      error: { code: string; message: string; details?: { providerStatus?: number; providerMessage?: string } };
      requestId: string;
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('invalid_request');
    expect(payload.error.message).toContain('rejected the request');
    expect(payload.error.details?.providerStatus).toBe(400);
    expect(payload.error.details?.providerMessage?.length).toBeLessThanOrEqual(200);
    expect(payload.requestId).toEqual(expect.any(String));
    expect(response.headers.get('x-request-id')).toBe(payload.requestId);
  });

  it('maps provider unauthorized and rate_limited errors', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'person@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({ id: 'folder-1' } as never);
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: '',
      },
    } as never);
    mockBuildContextPack.mockResolvedValue({
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });

    mockCallLLM.mockRejectedValueOnce(
      new ProviderError({
        code: 'unauthorized',
        status: 401,
        provider: 'openai',
        message: 'unauthorized',
      }),
    );

    const unauthorizedRequest = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Status update' }),
    });

    const unauthorizedResponse = await POST(unauthorizedRequest);
    const unauthorizedPayload = (await unauthorizedResponse.json()) as {
      error: { code: string; message: string };
      requestId: string;
    };

    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedPayload.error.code).toBe('provider_unauthorized');
    expect(unauthorizedPayload.requestId).toEqual(expect.any(String));

    mockCallLLM.mockRejectedValueOnce(
      new ProviderError({
        code: 'rate_limited',
        status: 429,
        provider: 'openai',
        message: 'rate limit',
        retryAfterSec: 30,
      }),
    );

    const rateLimitedRequest = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Status update' }),
    });

    const rateLimitedResponse = await POST(rateLimitedRequest);
    const rateLimitedPayload = (await rateLimitedResponse.json()) as {
      error: { code: string; message: string; retryAfterSec?: number };
      requestId: string;
    };

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedPayload.error.code).toBe('rate_limited');
    expect(rateLimitedPayload.error.message).toContain('rate limit exceeded');
    expect(rateLimitedPayload.requestId).toEqual(expect.any(String));
  });

  it('falls back safely when router returns invalid JSON in advisor mode', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'person@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({ id: 'folder-1' } as never);
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: '',
      },
    } as never);
    mockBuildContextPack.mockResolvedValue({
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });
    mockCallLLM.mockResolvedValue({ text: 'not json' });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Need insights', advisorMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { reply: string };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('## Timeline summary');
    expect(payload.reply).toContain('## Suggested next steps');
  });

  it('does not fetch originals when allowOriginals is false', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'person@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({ id: 'folder-1' } as never);
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: '',
      },
    } as never);
    mockBuildContextPack.mockResolvedValue({
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({
        answer: 'Need more details.',
        needsOriginals: true,
        requestedArtifactIds: ['summary-1'],
        reason: 'Need exact quote',
      }),
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'details please', allowOriginals: false }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { reply: string };
    expect(response.status).toBe(200);
    expect(mockFetchOriginalTextForArtifact).not.toHaveBeenCalled();
    expect(payload.reply).toContain('Enable “Allow opening originals” to verify details.');
  });

  it('fetches up to 3 originals when allowed and requested by router', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'person@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({ id: 'folder-1' } as never);
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: '',
      },
    } as never);
    mockBuildContextPack.mockResolvedValue({
      items: [
        defaultContextItem,
        { ...defaultContextItem, artifactId: 'summary-2', sourceId: 'msg-2' },
        { ...defaultContextItem, artifactId: 'summary-3', sourceId: 'msg-3' },
        { ...defaultContextItem, artifactId: 'summary-4', sourceId: 'msg-4' },
      ],
      debug: { usedIndex: true, totalConsidered: 4 },
    });
    mockCallLLM
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer: 'Checking originals.',
          needsOriginals: true,
          requestedArtifactIds: ['summary-1', 'summary-2', 'summary-3', 'summary-4'],
          reason: 'Need detail',
        }),
      })
      .mockResolvedValueOnce({ text: 'Final with originals.' });

    mockFetchOriginalTextForArtifact.mockResolvedValue({
      artifactId: 'summary-1',
      title: 'Launch Plan',
      source: 'gmail',
      sourceId: 'msg-1',
      text: 'Original text',
      truncated: false,
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'details please', allowOriginals: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { reply: string };
    expect(response.status).toBe(200);
    expect(payload.reply).toContain('Final with originals');
    expect(mockFetchOriginalTextForArtifact).toHaveBeenCalledTimes(3);
  });

  it('truncates helper output to hard cap', () => {
    const long = 'a'.repeat(160_000);
    const result = truncateOriginalText(long, 150_000);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith('...[truncated]')).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(150_000);
  });
});
