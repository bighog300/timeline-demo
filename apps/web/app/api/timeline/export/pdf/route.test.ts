import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfkit', () => ({
  default: class MockPdfDocument {},
}));

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/timeline/exportArtifacts', () => ({
  loadArtifactsForExport: vi.fn(),
}));

vi.mock('../../../../lib/timeline/exportPdf', () => ({
  renderTimelinePdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));


vi.mock('../../../../lib/timeline/exportHistoryDrive', () => ({
  appendExportHistoryItem: vi.fn(),
}));
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { loadArtifactsForExport } from '../../../../lib/timeline/exportArtifacts';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockLoadArtifactsForExport = vi.mocked(loadArtifactsForExport);

describe('POST /api/timeline/export/pdf', () => {
  it('returns pdf headers with 200', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockLoadArtifactsForExport.mockResolvedValue([
      {
        artifactId: 'drive:file-1',
        source: 'drive',
        sourceId: 'file-1',
        title: 'Doc',
        createdAtISO: '2024-01-01T00:00:00.000Z',
        contentDateISO: '2024-01-01T00:00:00.000Z',
        summary: 'Summary sentence.',
        highlights: ['One'],
        driveFolderId: 'folder-1',
        driveFileId: 'file-1',
        model: 'stub',
        version: 1,
      },
    ] as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/export/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactIds: ['file-1'] }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
  });
});
