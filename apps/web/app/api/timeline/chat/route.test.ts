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
}));

vi.mock('../../../lib/llm/providerRouter', () => ({
  getTimelineProviderFromDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockLoadArtifactIndex = vi.mocked(loadArtifactIndex);
const mockGetTimelineProviderFromDrive = vi.mocked(getTimelineProviderFromDrive);

const buildArtifact = (overrides: Record<string, unknown> = {}) => ({
  artifactId: 'gmail:1',
  source: 'gmail',
  sourceId: '1',
  title: 'Thread 1',
  createdAtISO: '2026-01-01T00:00:00Z',
  summary: 'Summary 1',
  highlights: ['h1'],
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  model: 'stub',
  version: 1,
  ...overrides,
});

describe('POST /api/timeline/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
  });

  it('returns 200 with answer and citations for stub provider', async () => {
    const drive = {
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact() }),
      },
    };

    mockCreateDriveClient.mockReturnValue(drive as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [{ id: 'gmail:1', driveFileId: 'file-1', title: 'Thread 1' }],
      },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: {
        summarize: vi.fn(),
        timelineChat: vi.fn().mockResolvedValue({
          answer: 'Grounded answer',
          citations: [{ artifactId: 'gmail:1', excerpt: 'h1' }],
          usedArtifactIds: ['gmail:1'],
        }),
      },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'thread happened' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      answer: 'Grounded answer',
      citations: [{ artifactId: 'gmail:1', excerpt: 'h1' }],
      usedArtifactIds: ['gmail:1'],
    });
  });

  it('returns no results guidance when index has no artifacts and does not call provider', async () => {
    mockCreateDriveClient.mockReturnValue({ files: { get: vi.fn() } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [] },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'x y' }),
      }) as never,
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.usedArtifactIds).toEqual([]);
    expect(mockGetTimelineProviderFromDrive).not.toHaveBeenCalled();
  });

  it('maps bad provider output to provider_bad_output', async () => {
    mockCreateDriveClient.mockReturnValue({ files: { get: vi.fn().mockResolvedValue({ data: buildArtifact() }) } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [{ id: 'gmail:1', driveFileId: 'file-1', title: 'Thread 1' }],
      },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: {
        summarize: vi.fn(),
        timelineChat: vi.fn().mockRejectedValue(
          new ProviderError({ code: 'bad_output', status: 502, provider: 'timeline', message: 'bad' }),
        ),
      },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'thread happened' }),
      }) as never,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'provider_bad_output' });
  });

  it('retrieval ranking prefers title match over highlight-only match', async () => {
    const timelineChat = vi.fn().mockResolvedValue({ answer: 'ok', citations: [], usedArtifactIds: [] });
    const getMock = vi
      .fn()
      .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'a-title', driveFileId: 'file-1', title: 'Budget meeting', summary: 'other', highlights: ['none'] }) })
      .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'a-highlight', driveFileId: 'file-2', title: 'Random', summary: 'other', highlights: ['budget details'] }) });

    mockCreateDriveClient.mockReturnValue({ files: { get: getMock } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [
          { id: 'a-title', driveFileId: 'file-1', title: 'Budget meeting', contentDateISO: '2026-01-01T00:00:00Z' },
          { id: 'a-highlight', driveFileId: 'file-2', title: 'Random', contentDateISO: '2026-01-02T00:00:00Z' },
        ],
      },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat },
    } as never);

    await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'budget', limit: 1 }),
      }) as never,
    );

    expect(timelineChat).toHaveBeenCalled();
    const payload = timelineChat.mock.calls[0][0] as { artifacts: Array<{ artifactId: string }> };
    expect(payload.artifacts[0].artifactId).toBe('a-title');
  });

  it('tie-break for same score picks newer contentDateISO', async () => {
    const timelineChat = vi.fn().mockResolvedValue({ answer: 'ok', citations: [], usedArtifactIds: [] });
    const getMock = vi
      .fn()
      .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'older', driveFileId: 'file-1', title: 'Project launch', summary: 'launch details' }) })
      .mockResolvedValueOnce({ data: buildArtifact({ artifactId: 'newer', driveFileId: 'file-2', title: 'Project launch', summary: 'launch details' }) });

    mockCreateDriveClient.mockReturnValue({ files: { get: getMock } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [
          { id: 'older', driveFileId: 'file-1', title: 'Project launch', contentDateISO: '2026-01-01T00:00:00Z' },
          { id: 'newer', driveFileId: 'file-2', title: 'Project launch', contentDateISO: '2026-02-01T00:00:00Z' },
        ],
      },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat },
    } as never);

    await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'launch', limit: 1 }),
      }) as never,
    );

    const payload = timelineChat.mock.calls[0][0] as { artifacts: Array<{ artifactId: string }> };
    expect(payload.artifacts[0].artifactId).toBe('newer');
  });

  it('stopword-only query returns guidance and does not call provider', async () => {
    mockCreateDriveClient.mockReturnValue({ files: { get: vi.fn().mockResolvedValue({ data: buildArtifact() }) } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [{ id: 'gmail:1', driveFileId: 'file-1', title: 'Thread 1' }],
      },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'the and of' }),
      }) as never,
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.usedArtifactIds).toEqual([]);
    expect(payload.citations).toEqual([]);
    expect(mockGetTimelineProviderFromDrive).not.toHaveBeenCalled();
  });

  it('enforces payload context budget and reduces usedArtifactIds when needed', async () => {
    const timelineChat = vi.fn().mockResolvedValue({ answer: 'ok', citations: [], usedArtifactIds: [] });
    const longSummary = 'summary '.repeat(1600);
    const artifactData = (id: string, driveFileId: string) =>
      buildArtifact({ artifactId: id, driveFileId, title: `Title ${id}`, summary: longSummary, highlights: ['alpha', 'beta'] });

    const artifacts = Array.from({ length: 15 }).map((_, index) => ({
      id: `a${index + 1}`,
      driveFileId: `f${index + 1}`,
      title: `Title a${index + 1}`,
      contentDateISO: `2026-01-${String((index % 9) + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const getMock = vi.fn().mockImplementation((request: { fileId: string }) => {
      const id = request.fileId.replace('f', 'a');
      return Promise.resolve({ data: artifactData(id, request.fileId) });
    });

    mockCreateDriveClient.mockReturnValue({ files: { get: getMock } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts,
      },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'alpha', limit: 15 }),
      }) as never,
    );

    const payload = await response.json();
    expect(response.status).toBe(200);

    const providerPayload = timelineChat.mock.calls[0][0] as { artifacts: Array<{ summary: string }> };
    const totalChars = providerPayload.artifacts.reduce((acc, item) => acc + item.summary.length, 0);
    expect(totalChars).toBeLessThanOrEqual(24000);
    expect(payload.usedArtifactIds.length).toBeLessThan(15);
  });

  it('keeps at least one artifact in provider payload when artifacts exist', async () => {
    const timelineChat = vi.fn().mockResolvedValue({ answer: 'ok', citations: [], usedArtifactIds: [] });
    const huge = 'x'.repeat(40_000);

    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact({ artifactId: 'only', driveFileId: 'f1', summary: huge }) }),
      },
    } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [{ id: 'only', driveFileId: 'f1', title: 'Only' }],
      },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: { summarize: vi.fn(), timelineChat },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'only topic' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    const providerPayload = timelineChat.mock.calls[0][0] as { artifacts: Array<{ artifactId: string }> };
    expect(providerPayload.artifacts).toHaveLength(1);
    await expect(response.json()).resolves.toMatchObject({ usedArtifactIds: ['only'] });
  });
});
