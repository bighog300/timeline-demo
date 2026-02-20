import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/timeline/artifactIndex', () => ({
  loadArtifactIndex: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { POST } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDrive = vi.mocked(createDriveClient);

const baseArtifact = (overrides: Record<string, unknown> = {}) => ({
  artifactId: 'a1',
  source: 'drive',
  sourceId: 'src-1',
  title: 'A1',
  createdAtISO: '2026-01-01T00:00:00.000Z',
  summary: 'Met on 2026-02-14 to review.',
  highlights: ['Reviewed scope'],
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  model: 'stub',
  version: 1,
  type: 'summary',
  status: 'complete',
  id: 'file-1',
  updatedAtISO: '2026-01-01T00:00:00.000Z',
  meta: { driveFileId: 'file-1', driveFolderId: 'folder-1', source: 'drive', sourceId: 'src-1', model: 'stub', version: 1 },
  ...overrides,
});

describe('POST /api/timeline/quality/date-candidates', () => {
  it('returns sourceMetadata candidate', async () => {
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'a@b.c' } } as never);
    mockAccessToken.mockResolvedValue('token');

    const get = vi.fn().mockResolvedValue({ data: baseArtifact({ sourceMetadata: { dateISO: '2026-02-10T00:00:00.000Z' } }) });
    mockCreateDrive.mockReturnValue({ files: { get } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/quality/date-candidates', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'file-1' }),
    }) as never);

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dateISO: '2026-02-10T00:00:00.000Z',
        source: 'sourceMetadata',
      }),
    ]));
  });

  it('returns text_regex candidate with snippet', async () => {
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'a@b.c' } } as never);
    mockAccessToken.mockResolvedValue('token');

    const get = vi.fn().mockResolvedValue({ data: baseArtifact({ sourceMetadata: undefined, summary: 'Event happened on 14/02/2026 and follow-up later.' }) });
    mockCreateDrive.mockReturnValue({ files: { get } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/quality/date-candidates', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'file-1' }),
    }) as never);

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dateISO: '2026-02-14T00:00:00.000Z',
        source: 'text_regex',
        evidenceSnippet: expect.stringContaining('14/02/2026'),
      }),
    ]));
  });
});
