import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/appDriveFolder', () => ({
  resolveOrProvisionAppDriveFolder: vi.fn(),
}));

vi.mock('../../../lib/timeline/artifactIndex', () => ({
  loadArtifactIndex: vi.fn(),
  saveArtifactIndex: vi.fn(),
  upsertArtifactIndexEntry: vi.fn((index, entry) => ({ ...index, artifacts: [...index.artifacts, entry] })),
}));

vi.mock('../../../lib/llm/providerRouter', () => ({
  getTimelineProviderFromDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { loadArtifactIndex, saveArtifactIndex, upsertArtifactIndexEntry } from '../../../lib/timeline/artifactIndex';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockLoadArtifactIndex = vi.mocked(loadArtifactIndex);
const mockGetTimelineProviderFromDrive = vi.mocked(getTimelineProviderFromDrive);
const mockSaveArtifactIndex = vi.mocked(saveArtifactIndex);
const mockUpsertArtifactIndexEntry = vi.mocked(upsertArtifactIndexEntry);

const buildArtifact = (overrides: Record<string, unknown> = {}) => ({
  artifactId: 'gmail:1',
  source: 'gmail',
  sourceId: '1',
  title: 'Artifact 1',
  createdAtISO: '2026-01-01T00:00:00Z',
  contentDateISO: '2026-01-01T00:00:00Z',
  summary: 'Summary 1',
  highlights: ['h1'],
  evidence: [{ excerpt: 'evidence 1' }],
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  model: 'stub',
  version: 1,
  ...overrides,
});

describe('POST /api/timeline/synthesize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
  });

  it('happy path: filters by date, respects limit, returns content and filtered citations', async () => {
    const timelineSynthesize = vi.fn().mockResolvedValue({
      synthesis: {
        synthesisId: 'syn-1',
        mode: 'briefing',
        title: 'Briefing',
        createdAtISO: '2026-01-02T00:00:00Z',
        content: 'Synthesized content',
      },
      citations: [
        { artifactId: 'a2', excerpt: 'second' },
        { artifactId: 'unknown', excerpt: 'drop me' },
      ],
    });

    const drive = {
      files: {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'a2', driveFileId: 'f2', summary: 'Summary 2' }) })
          .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1', summary: 'Summary 1' }) }),
        create: vi.fn().mockResolvedValue({ data: { id: 'saved-file' } }),
      },
    };

    mockCreateDriveClient.mockReturnValue(drive as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [
          { id: 'a1', driveFileId: 'f1', title: 'Old', contentDateISO: '2026-01-01T00:00:00Z' },
          { id: 'a2', driveFileId: 'f2', title: 'New', contentDateISO: '2026-01-02T00:00:00Z' },
        ],
      },
    });
    mockSaveArtifactIndex.mockResolvedValue({ fileId: 'idx-1', index: { version: 1, updatedAtISO: 'x', artifacts: [] } } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', dateFromISO: '2026-01-01T00:00:00Z', limit: 2 }),
      }) as never,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.synthesis.content).toBe('Synthesized content');
    expect(payload.citations).toEqual([{ artifactId: 'a2', excerpt: 'second', title: 'New', contentDateISO: '2026-01-02T00:00:00Z' }]);
    expect(payload.usedArtifactIds).toEqual(['a2', 'a1']);
    expect(timelineSynthesize).toHaveBeenCalled();
  });

  it('explicit artifactIds path', async () => {
    const timelineSynthesize = vi.fn().mockResolvedValue({
      synthesis: { synthesisId: 'syn-1', mode: 'briefing', title: 't', createdAtISO: '2026-01-01T00:00:00Z', content: 'c' },
      citations: [],
    });
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1' }) }),
        create: vi.fn().mockResolvedValue({ data: { id: 'saved-file' } }),
      },
    } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1', title: 'A1' }] },
    });
    mockSaveArtifactIndex.mockResolvedValue({ fileId: 'idx-1', index: { version: 1, updatedAtISO: 'x', artifacts: [] } } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', artifactIds: ['a1'] }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(timelineSynthesize).toHaveBeenCalled();
  });

  it('no artifacts returns guidance and does not call provider', async () => {
    mockCreateDriveClient.mockReturnValue({ files: { get: vi.fn(), create: vi.fn() } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [] },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.usedArtifactIds).toEqual([]);
    expect(mockGetTimelineProviderFromDrive).not.toHaveBeenCalled();
  });

  it('budget enforcement keeps payload under cap', async () => {
    const timelineSynthesize = vi.fn().mockResolvedValue({
      synthesis: { synthesisId: 'syn-1', mode: 'briefing', title: 't', createdAtISO: '2026-01-01T00:00:00Z', content: 'c' },
      citations: [],
    });
    const huge = 'x'.repeat(20_000);
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1', summary: huge }) })
          .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'a2', driveFileId: 'f2', summary: huge }) }),
        create: vi.fn().mockResolvedValue({ data: { id: 'saved-file' } }),
      },
    } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [
          { id: 'a1', driveFileId: 'f1', title: 'A1' },
          { id: 'a2', driveFileId: 'f2', title: 'A2' },
        ],
      },
    });
    mockSaveArtifactIndex.mockResolvedValue({ fileId: 'idx-1', index: { version: 1, updatedAtISO: 'x', artifacts: [] } } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', limit: 2 }),
      }) as never,
    );

    const providerPayload = timelineSynthesize.mock.calls[0][0] as { artifacts: Array<{ summary: string }> };
    const total = providerPayload.artifacts.reduce((acc, item) => acc + item.summary.length, 0);
    expect(total).toBeLessThanOrEqual(24_000);
  });

  it('saveToTimeline=true writes drive file and upserts index', async () => {
    const timelineSynthesize = vi.fn().mockResolvedValue({
      synthesis: { synthesisId: 'syn-1', mode: 'briefing', title: 't', createdAtISO: '2026-01-01T00:00:00Z', content: 'c' },
      citations: [],
    });
    const drive = {
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1' }) }),
        create: vi.fn().mockResolvedValue({ data: { id: 'saved-file' } }),
      },
    };
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1', title: 'A1' }] },
    });
    mockSaveArtifactIndex.mockResolvedValue({ fileId: 'idx-1', index: { version: 1, updatedAtISO: 'x', artifacts: [] } } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', saveToTimeline: true }),
      }) as never,
    );

    const payload = await response.json();
    expect(drive.files.create).toHaveBeenCalled();
    expect(mockUpsertArtifactIndexEntry).toHaveBeenCalled();
    expect(mockSaveArtifactIndex).toHaveBeenCalled();
    expect(payload.savedArtifactId).toBeDefined();
  });

  it('saveToTimeline=false skips drive writes', async () => {
    const timelineSynthesize = vi.fn().mockResolvedValue({
      synthesis: { synthesisId: 'syn-1', mode: 'briefing', title: 't', createdAtISO: '2026-01-01T00:00:00Z', content: 'c' },
      citations: [],
    });
    const drive = {
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1' }) }),
        create: vi.fn().mockResolvedValue({ data: { id: 'saved-file' } }),
      },
    };
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1', title: 'A1' }] },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', saveToTimeline: false }),
      }) as never,
    );

    expect(drive.files.create).not.toHaveBeenCalled();
    expect(mockSaveArtifactIndex).not.toHaveBeenCalled();
  });


  it('normalizes and persists synthesis suggestedActions when saveToTimeline=true', async () => {
    const timelineSynthesize = vi.fn().mockResolvedValue({
      synthesis: {
        synthesisId: 'syn-99',
        mode: 'briefing',
        title: 't',
        createdAtISO: '2026-01-01T00:00:00Z',
        content: 'c',
        suggestedActions: [{ type: 'task', text: 'Follow up with owner', confidence: 0.8 }],
      },
      citations: [],
    });
    const drive = {
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1' }) }),
        create: vi.fn().mockResolvedValue({ data: { id: 'saved-file' } }),
      },
    };
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1', title: 'A1' }] },
    });
    mockSaveArtifactIndex.mockResolvedValue({ fileId: 'idx-1', index: { version: 1, updatedAtISO: 'x', artifacts: [] } } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', saveToTimeline: true }),
      }) as never,
    );

    const payload = await response.json();
    expect(payload.synthesis.suggestedActions[0].status).toBe('proposed');
    const savedBody = JSON.parse((drive.files.create as ReturnType<typeof vi.fn>).mock.calls[0][0].media.body as string);
    expect(savedBody.suggestedActions[0].id).toBeTruthy();
    expect(savedBody.suggestedActions[0].createdAtISO).toBeTruthy();
  });

  it('returns synthesis suggestedActions without persistence when saveToTimeline=false', async () => {
    const timelineSynthesize = vi.fn().mockResolvedValue({
      synthesis: {
        synthesisId: 'syn-1',
        mode: 'briefing',
        title: 't',
        createdAtISO: '2026-01-01T00:00:00Z',
        content: 'c',
        suggestedActions: [{ type: 'reminder', text: 'Ping finance team' }],
      },
      citations: [],
    });
    const drive = {
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1' }) }),
        create: vi.fn().mockResolvedValue({ data: { id: 'saved-file' } }),
      },
    };
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1', title: 'A1' }] },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', saveToTimeline: false }),
      }) as never,
    );

    const payload = await response.json();
    expect(payload.synthesis.suggestedActions).toHaveLength(1);
    expect(payload.savedArtifactId).toBeUndefined();
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it('auth missing -> 401', async () => {
    mockGetGoogleSession.mockResolvedValue(null as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing' }),
      }) as never,
    );

    expect(response.status).toBe(401);
  });

  it('invalid payload -> 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'bad-mode' }),
      }) as never,
    );

    expect(response.status).toBe(400);
  });

  it('provider bad output -> provider_bad_output', async () => {
    const timelineSynthesize = vi.fn().mockRejectedValue(
      new ProviderError({ code: 'bad_output', status: 502, provider: 'timeline', message: 'bad' }),
    );
    mockCreateDriveClient.mockReturnValue({
      files: { get: vi.fn().mockResolvedValue({ data: buildArtifact({ artifactId: 'a1', driveFileId: 'f1' }) }), create: vi.fn() },
    } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1', title: 'A1' }] },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat: vi.fn(), timelineSynthesize },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/synthesize', {
        method: 'POST',
        body: JSON.stringify({ mode: 'briefing', saveToTimeline: false }),
      }) as never,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'provider_bad_output' });
  });
});
