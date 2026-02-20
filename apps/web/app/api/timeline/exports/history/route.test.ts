import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/timeline/exportHistoryDrive', () => ({
  readExportHistory: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { readExportHistory } from '../../../../lib/timeline/exportHistoryDrive';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockReadExportHistory = vi.mocked(readExportHistory);

describe('GET /api/timeline/exports/history', () => {
  it('returns newest-first and respects limit', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'test@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadExportHistory.mockResolvedValue({
      version: 1,
      updatedAtISO: '2024-03-01T00:00:00.000Z',
      items: [
        {
          exportId: 'exp-1',
          createdAtISO: '2024-01-01T00:00:00.000Z',
          format: 'pdf',
          artifactIds: ['f1'],
          artifactCount: 1,
          source: { viewMode: 'summaries' },
          result: { pdf: { filename: 'a.pdf' } },
        },
        {
          exportId: 'exp-2',
          createdAtISO: '2024-01-02T00:00:00.000Z',
          format: 'drive_doc',
          artifactIds: ['f2'],
          artifactCount: 1,
          source: { viewMode: 'timeline' },
          result: { driveDoc: { docId: 'doc-2', webViewLink: 'https://drive.google.com/doc-2' } },
        },
      ],
    });

    const response = await GET(new Request('http://localhost/api/timeline/exports/history?limit=1') as never);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.updatedAtISO).toBe('2024-03-01T00:00:00.000Z');
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].exportId).toBe('exp-2');
  });
});
