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

const secondContextItem = {
  ...defaultContextItem,
  artifactId: 'summary-2',
  sourceId: 'msg-2',
  title: 'Follow-up Notes',
};

const thirdContextItem = {
  ...defaultContextItem,
  artifactId: 'summary-3',
  sourceId: 'msg-3',
  title: 'Police Call Notes',
};

const selectionSetMetaItem = {
  kind: 'selection_set' as const,
  id: 'sel-1',
  title: 'Saved search',
  source: 'gmail' as const,
  q: 'from:person@example.com',
  updatedAtISO: '2024-01-03T00:00:00.000Z',
  text: 'Saved search metadata only.',
};

const runMetaItem = {
  kind: 'run' as const,
  id: 'run-1',
  action: 'run' as const,
  selectionSetId: 'sel-1',
  selectionSetTitle: 'Saved search',
  startedAtISO: '2024-01-03T00:00:00.000Z',
  finishedAtISO: '2024-01-03T00:01:00.000Z',
  status: 'success' as const,
  text: 'Run metadata only.',
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

  it('returns synthesis headings when synthesisMode is enabled', async () => {
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
      items: [defaultContextItem, secondContextItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({
        answer: `## Synthesized timeline
- Event [1].

## Key actors and entities
- Actor [1].

## Actor timelines
- Actor timeline [1].

## Themes grouped view
- Theme grouping [1].

## Themes and turning points
- Theme [1].

## Legal considerations (general information)
- Note [1].
- Not legal advice.

## Psychological and interpersonal signals (non-clinical)
- Signal [1].
- Not a diagnosis.

## Contradictions and uncertainties
- Uncertainty [1].

## Questions to clarify
- Question?

## Suggested next steps
- Next step.`,
        needsOriginals: false,
        requestedArtifactIds: [],
        reason: 'Sufficient summaries',
      }),
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize last month', synthesisMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { reply: string };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('## Synthesized timeline');
    expect(payload.reply).toContain('## Key actors and entities');
    expect(payload.reply).toContain('## Actor timelines');
    expect(payload.reply).toContain('## Themes grouped view');
    expect(payload.reply).toContain('## Contradictions and uncertainties');
  });

  it('returns synthesis guidance and skips LLM when synthesisMode has 0 sources', async () => {
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
      items: [],
      debug: { usedIndex: true, totalConsidered: 0 },
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize timeline', synthesisMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: unknown[];
      suggested_actions: string[];
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toBe('Need at least 2 sources to synthesize a timeline.');
    expect(payload.citations).toEqual([]);
    expect(payload.suggested_actions).toEqual([
      'Go to /timeline and click Full sync',
      'Summarize items in /select/gmail or /select/drive',
    ]);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('returns synthesis guidance and skips LLM when synthesisMode has 1 source', async () => {
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

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize timeline', synthesisMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toBe('Need at least 2 sources to synthesize a timeline.');
    expect(payload.citations).toEqual([]);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('returns no-source guidance when context has only metadata items', async () => {
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
      items: [selectionSetMetaItem, runMetaItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'What happened?' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('No timeline sources available');
    expect(payload.citations).toEqual([]);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('returns synthesis guidance with one summary even when metadata items are present', async () => {
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
      items: [defaultContextItem, selectionSetMetaItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize timeline', synthesisMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('Need at least 2 sources');
    expect(payload.citations).toEqual([]);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });


  it('uses recent context selection for blank messages and preserves source guards', async () => {
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
    mockCallLLM.mockResolvedValue({ text: '[stub: answer]' });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.reply).not.toBe('No timeline sources available to analyze.');
    expect(mockBuildContextPack).toHaveBeenCalledWith(
      expect.objectContaining({ queryText: 'recent' }),
    );
    expect(mockCallLLM).toHaveBeenCalledTimes(1);

    mockBuildContextPack.mockResolvedValueOnce({
      items: [],
      debug: { usedIndex: true, totalConsidered: 0 },
    });

    const noSummaryResponse = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '   ' }),
      }),
    );
    const noSummaryPayload = (await noSummaryResponse.json()) as { reply: string };

    expect(noSummaryPayload.reply).toBe('No timeline sources available to analyze.');

    mockBuildContextPack.mockResolvedValueOnce({
      items: [defaultContextItem],
      debug: { usedIndex: true, totalConsidered: 1 },
    });

    const synthesisResponse = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '   ', synthesisMode: true }),
      }),
    );
    const synthesisPayload = (await synthesisResponse.json()) as { reply: string };

    expect(synthesisPayload.reply).toBe('Need at least 2 sources to synthesize a timeline.');
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  it('returns no-source guidance in normal mode when context is empty', async () => {
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
      items: [],
      debug: { usedIndex: true, totalConsidered: 0 },
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'What happened?' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toBe('No timeline sources available to analyze.');
    expect(payload.citations).toEqual([]);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('applies advisor and synthesis prompt addenda when synthesisMode is true', async () => {
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
      items: [defaultContextItem, secondContextItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({
        answer: `## Synthesized timeline
- Event [1].

## Key actors and entities
- Actor [1].

## Actor timelines
- Actor timeline [1].

## Themes grouped view
- Theme grouping [1].

## Themes and turning points
- Theme [1].

## Legal considerations (general information)
- Note [1].
- Not legal advice.

## Psychological and interpersonal signals (non-clinical)
- Signal [1].
- Not a diagnosis.

## Contradictions and uncertainties
- Uncertainty [1].

## Questions to clarify
- Question?

## Suggested next steps
- Next step.`,
        needsOriginals: false,
        requestedArtifactIds: [],
        reason: 'Sufficient summaries',
      }),
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize timeline', synthesisMode: true, advisorMode: false }),
    });

    await POST(request);

    const firstCall = mockCallLLM.mock.calls[0]?.[1];
    expect(firstCall?.systemPrompt).toContain('## Timeline summary');
    expect(firstCall?.systemPrompt).toContain('## Synthesized timeline');
    expect(firstCall?.systemPrompt).toContain('## Actor timelines');
    expect(firstCall?.systemPrompt).toContain('## Themes grouped view');
  });



  it('filters extraction events without citations before synthesis write-up', async () => {
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
      items: [defaultContextItem, secondContextItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });
    mockCallLLM
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer: `## Synthesized timeline\n- Direct answer [1].`,
          needsOriginals: false,
          requestedArtifactIds: [],
          reason: 'Sufficient summaries',
        }),
      })
      .mockResolvedValueOnce({
        text: `Here is the plan:
${JSON.stringify({
          entities: [
            {
              id: 'e1',
              type: 'person',
              canonical: 'A Person <a@example.com>',
              aliases: ['A Person'],
              confidence: 'high',
              citations: [1],
            },
          ],
          events: [
            {
              id: 'v1',
              dateISO: null,
              dateLabel: 'Unknown',
              actors: ['e1'],
              summary: 'Grounded event',
              theme: 'coordination',
              impact: 'Baseline',
              citations: [1],
            },
            {
              id: 'v2',
              dateISO: null,
              dateLabel: 'Unknown',
              actors: ['e1'],
              summary: 'Ungrounded event',
              theme: 'coordination',
              impact: 'Should be removed',
              citations: [],
            },
            {
              id: 'v3',
              dateISO: null,
              dateLabel: 'Unknown',
              actors: ['e1'],
              summary: 'Out of range citation event',
              theme: 'coordination',
              impact: 'Should be removed',
              citations: [99],
            },
          ],
        })}
Thanks`,
      })
      .mockResolvedValueOnce({ text: `## Synthesized timeline\n- Planned answer [1].` });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize timeline', synthesisMode: true }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const writeupCall = mockCallLLM.mock.calls[2]?.[1];
    const planMessage = writeupCall?.messages?.find((msg: { content: string }) =>
      msg.content.startsWith('PLAN JSON:'),
    );
    expect(planMessage?.content).toContain('Grounded event');
    expect(planMessage?.content).not.toContain('Ungrounded event');
    expect(planMessage?.content).not.toContain('Out of range citation event');
  });


  it('parses fenced synthesis extraction JSON with trailing prose', async () => {
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
      items: [defaultContextItem, secondContextItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });
    mockCallLLM
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer: `## Synthesized timeline
- Direct answer [1].`,
          needsOriginals: false,
          requestedArtifactIds: [],
          reason: 'Sufficient summaries',
        }),
      })
      .mockResolvedValueOnce({
        text: `\`\`\`json
${JSON.stringify({
  entities: [
    {
      id: 'e1',
      type: 'person',
      canonical: 'A Person <a@example.com>',
      aliases: ['A Person'],
      confidence: 'high',
      citations: [1],
    },
  ],
  events: [
    {
      id: 'v1',
      dateISO: null,
      dateLabel: 'Unknown',
      actors: ['e1'],
      summary: 'Fenced grounded event',
      theme: 'coordination',
      impact: 'Baseline',
      citations: [1],
    },
  ],
})}
\`\`\`
Thanks`,
      })
      .mockResolvedValueOnce({ text: `## Synthesized timeline
- Planned answer [1].` });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize timeline', synthesisMode: true }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const writeupCall = mockCallLLM.mock.calls[2]?.[1];
    const planMessage = writeupCall?.messages?.find((msg: { content: string }) =>
      msg.content.startsWith('PLAN JSON:'),
    );
    expect(planMessage?.content).toContain('Fenced grounded event');
  });

  it('falls back to direct synthesis when extraction JSON is invalid', async () => {
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
      items: [defaultContextItem, secondContextItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });
    mockCallLLM
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer: `## Synthesized timeline
- Event [1].

## Key actors and entities
- Actor [1].

## Actor timelines
- Actor timeline [1].

## Themes grouped view
- Theme grouping [1].

## Themes and turning points
- Theme [1].

## Legal considerations (general information)
- Note [1].
- Not legal advice.

## Psychological and interpersonal signals (non-clinical)
- Signal [1].
- Not a diagnosis.

## Contradictions and uncertainties
- Uncertainty [1].

## Questions to clarify
- Question?

## Suggested next steps
- Next step.`,
          needsOriginals: false,
          requestedArtifactIds: [],
          reason: 'Sufficient summaries',
        }),
      })
      .mockResolvedValueOnce({ text: 'not-json' });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Synthesize timeline', synthesisMode: true }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { reply: string };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('## Actor timelines');
    expect(payload.reply).toContain('## Themes grouped view');
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

  it('returns server-computed count for counting questions', async () => {
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
        { ...defaultContextItem, snippet: 'Yvette called the police after the argument.' },
        { ...secondContextItem, snippet: 'Yvette called the police again the next day.' },
        { ...thirdContextItem, snippet: 'This summary does not include a police call.' },
      ],
      debug: { usedIndex: true, totalConsidered: 3 },
    });
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({
        occurrences: [
          {
            who: 'Yvette',
            action: 'called the police',
            when: 'after the argument',
            where: null,
            evidence: 'Summary states she called the police.',
            citations: [1],
          },
          {
            who: 'Yvette',
            action: 'called the police',
            when: 'the next day',
            where: null,
            evidence: 'Summary states she called the police again.',
            citations: [2],
          },
        ],
        notes: null,
      }),
    });

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'How many times did Yvette call the police?' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      reply: string;
      citations: Array<{ artifactId: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('I found 2 occurrences');
    expect(payload.citations.map((citation) => citation.artifactId)).toEqual(['summary-1', 'summary-2']);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockCallLLM.mock.calls[0]?.[1].messages[2].content).toContain('Return STRICT JSON only with shape');
  });

  it('filters uncited and out-of-range counting occurrences', async () => {
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
      items: [defaultContextItem, secondContextItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({
        occurrences: [
          { who: 'Yvette', action: 'called', when: null, where: null, evidence: 'no cites' },
          {
            who: 'Yvette',
            action: 'called',
            when: null,
            where: null,
            evidence: 'bad cite',
            citations: [999],
          },
          {
            who: 'Yvette',
            action: 'called',
            when: 'Monday',
            where: null,
            evidence: 'good cite',
            citations: [2],
          },
        ],
        notes: null,
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'count police calls' }),
      }),
    );
    const payload = (await response.json()) as {
      reply: string;
      citations: Array<{ artifactId: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('I found 1 occurrence');
    expect(payload.citations).toEqual([
      {
        artifactId: 'summary-2',
        title: 'Follow-up Notes',
        dateISO: '2024-01-02T00:00:00.000Z',
        kind: 'summary',
      },
    ]);
  });


  it('deduplicates logically identical counting occurrences before computing total', async () => {
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
      items: [defaultContextItem, secondContextItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({
        occurrences: [
          {
            who: ' Yvette ',
            action: 'called the police',
            when: 'Monday',
            where: 'Home',
            evidence: 'Summary 1 references one call.',
            citations: [1],
          },
          {
            who: 'yvette',
            action: 'called the police',
            when: ' monday ',
            where: ' home ',
            evidence: 'Summary 2 references the same call.',
            citations: [2],
          },
        ],
        notes: null,
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'How many times did Yvette call the police?' }),
      }),
    );
    const payload = (await response.json()) as {
      reply: string;
      citations: Array<{ artifactId: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('I found 1 occurrence');
    expect(payload.citations.map((citation) => citation.artifactId)).toEqual(['summary-1', 'summary-2']);
  });

  it('does not guess counting answers when summaries are insufficient', async () => {
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
    mockCallLLM.mockResolvedValue({ text: JSON.stringify({ occurrences: [], notes: 'Insufficient detail.' }) });

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'How many times was the police called?' }),
      }),
    );
    const payload = (await response.json()) as { reply: string; suggested_actions: string[] };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('I can’t confirm from summaries alone');
    expect(payload.suggested_actions.join(' ')).toContain('Allow opening originals');
  });

  it('returns guidance and skips provider call when counting question has zero summaries', async () => {
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
      items: [selectionSetMetaItem, runMetaItem],
      debug: { usedIndex: true, totalConsidered: 2 },
    });

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'How many times?' }),
      }),
    );
    const payload = (await response.json()) as { reply: string };

    expect(response.status).toBe(200);
    expect(payload.reply).toContain('No timeline sources available to analyze.');
    expect(mockCallLLM).not.toHaveBeenCalled();
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
