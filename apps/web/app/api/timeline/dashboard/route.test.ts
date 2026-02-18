import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/timeline/artifactIndex', () => ({
  loadArtifactIndex: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockLoadArtifactIndex = vi.mocked(loadArtifactIndex);

const buildSummaryArtifact = (id: string, status: 'proposed' | 'accepted' = 'proposed') => ({
  artifactId: id,
  source: 'gmail',
  sourceId: id,
  title: `Summary ${id}`,
  createdAtISO: '2026-01-01T00:00:00Z',
  summary: 'summary',
  highlights: [],
  driveFolderId: 'folder-1',
  driveFileId: `file-${id}`,
  model: 'stub',
  version: 1,
  suggestedActions: [{ id: `act-${id}`, type: 'task', text: `Action ${id}`, status }],
});

const buildSynthesisArtifact = (id: string) => ({
  kind: 'synthesis',
  id,
  title: `Synthesis ${id}`,
  mode: 'briefing',
  createdAtISO: '2026-01-03T00:00:00Z',
  sourceArtifactIds: ['a1'],
  content: 'content',
  citations: [{ artifactId: 'a1', excerpt: 'x' }],
  suggestedActions: [{ id: `syn-act-${id}`, type: 'calendar', text: 'Schedule follow-up', status: 'proposed', dueDateISO: '2026-02-01T10:00:00Z' }],
});

describe('GET /api/timeline/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 't@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
  });

  it('returns syntheses sorted and action queue with proposed first', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: buildSynthesisArtifact('syn-1') })
      .mockResolvedValueOnce({ data: buildSummaryArtifact('a1', 'accepted') })
      .mockResolvedValueOnce({ data: buildSummaryArtifact('a2', 'proposed') });
    mockCreateDriveClient.mockReturnValue({ files: { get } } as never);
    mockLoadArtifactIndex.mockResolvedValue({
      fileId: 'idx-1',
      index: {
        version: 1,
        updatedAtISO: '2026-01-03T00:00:00Z',
        artifacts: [
          { id: 'syn-1', kind: 'synthesis', driveFileId: 'f-syn', title: 'S1', contentDateISO: '2026-01-03T00:00:00Z' },
          { id: 'a1', kind: 'summary', driveFileId: 'f-a1', title: 'A1', contentDateISO: '2026-01-02T00:00:00Z' },
          { id: 'a2', kind: 'summary', driveFileId: 'f-a2', title: 'A2', contentDateISO: '2026-01-01T00:00:00Z' },
        ],
      },
    } as never);

    const response = await GET(new Request('http://localhost/api/timeline/dashboard') as never);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.syntheses[0].artifactId).toBe('syn-1');
    expect(payload.actionQueue[0].action.status).toBe('proposed');
    expect(payload.actionQueue[payload.actionQueue.length - 1].action.status).toBe('accepted');
  });

  it('respects bounded artifact reads', async () => {
    const entries = Array.from({ length: 90 }).map((_, i) => ({
      id: `a${i}`,
      kind: 'summary' as const,
      driveFileId: `f-${i}`,
      title: `A${i}`,
      contentDateISO: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const get = vi.fn().mockResolvedValue({ data: buildSummaryArtifact('any') });
    mockCreateDriveClient.mockReturnValue({ files: { get } } as never);
    mockLoadArtifactIndex.mockResolvedValue({ fileId: 'idx-1', index: { version: 1, updatedAtISO: 'x', artifacts: entries } } as never);

    const response = await GET(new Request('http://localhost/api/timeline/dashboard') as never);
    expect(response.status).toBe(200);
    expect(get.mock.calls.length).toBeLessThanOrEqual(60);
  });

  it('auth missing -> 401', async () => {
    mockGetGoogleSession.mockResolvedValue(null as never);

    const response = await GET(new Request('http://localhost/api/timeline/dashboard') as never);
    expect(response.status).toBe(401);
  });
});
