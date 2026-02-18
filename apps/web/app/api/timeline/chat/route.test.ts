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

describe('POST /api/timeline/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('returns 200 with answer and citations for stub provider', async () => {
    const drive = {
      files: {
        get: vi.fn().mockResolvedValue({
          data: {
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
          },
        }),
      },
    };

    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
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
        body: JSON.stringify({ query: 'what happened' }),
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
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
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
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({
          data: {
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
          },
        }),
      },
    } as never);
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
        body: JSON.stringify({ query: 'what happened' }),
      }) as never,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'provider_bad_output' });
  });

  it('retrieval respects date filter and limit', async () => {
    const getMock = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          artifactId: 'a2',
          source: 'gmail',
          sourceId: '2',
          title: 'New',
          createdAtISO: '2026-03-01T00:00:00Z',
          summary: 'new summary',
          highlights: ['new'],
          driveFolderId: 'folder-1',
          driveFileId: 'file-2',
          model: 'stub',
          version: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          artifactId: 'a3',
          source: 'gmail',
          sourceId: '3',
          title: 'Newest',
          createdAtISO: '2026-03-02T00:00:00Z',
          summary: 'newest summary',
          highlights: ['newest'],
          driveFolderId: 'folder-1',
          driveFileId: 'file-3',
          model: 'stub',
          version: 1,
        },
      });

    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({ files: { get: getMock } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-03-01T00:00:00Z',
        artifacts: [
          { id: 'a1', driveFileId: 'file-1', title: 'Old', contentDateISO: '2025-01-01T00:00:00Z' },
          { id: 'a2', driveFileId: 'file-2', title: 'New', contentDateISO: '2026-03-01T00:00:00Z' },
          { id: 'a3', driveFileId: 'file-3', title: 'Newest', contentDateISO: '2026-03-02T00:00:00Z' },
        ],
      },
    });
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub' },
      provider: {
        summarize: vi.fn(),
        timelineChat: vi.fn().mockResolvedValue({ answer: 'ok', citations: [], usedArtifactIds: ['a2', 'a3'] }),
      },
    } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/chat', {
        method: 'POST',
        body: JSON.stringify({ query: 'new', dateFromISO: '2026-01-01T00:00:00Z', limit: 2 }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
