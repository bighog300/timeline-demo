import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/googleGmail', () => ({
  createGmailClient: vi.fn(),
}));

vi.mock('../../../lib/fetchSourceText', () => ({
  fetchGmailMessageText: vi.fn(),
  fetchDriveFileText: vi.fn(),
}));

vi.mock('../../../lib/indexDrive', () => ({
  findIndexFile: vi.fn(),
  readIndexFile: vi.fn(),
  writeIndexFile: vi.fn(),
}));

vi.mock('../../../lib/llm/providerRouter', () => ({
  getTimelineProviderFromDrive: vi.fn(),
}));

vi.mock('../../../lib/writeArtifactToDrive', () => ({
  writeArtifactToDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { findIndexFile, readIndexFile, writeIndexFile } from '../../../lib/indexDrive';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockCreateGmailClient = vi.mocked(createGmailClient);
const mockFetchGmailMessageText = vi.mocked(fetchGmailMessageText);
const mockFindIndexFile = vi.mocked(findIndexFile);
const mockReadIndexFile = vi.mocked(readIndexFile);
const mockWriteIndexFile = vi.mocked(writeIndexFile);
const mockGetTimelineProviderFromDrive = vi.mocked(getTimelineProviderFromDrive);
const mockWriteArtifactToDrive = vi.mocked(writeArtifactToDrive);

const makeDrive = () => ({ files: { get: vi.fn(), list: vi.fn() } });

describe('POST /api/timeline/summarize-missing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 on invalid body', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize-missing', {
        method: 'POST',
        body: JSON.stringify({ selectionSetId: '', limit: 0 }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'invalid_request' });
  });

  it('enforces limit cap and only processes requested missing items', async () => {
    const drive = makeDrive();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'u@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockCreateGmailClient.mockReturnValue({} as never);
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({ summaries: [] } as never);
    mockWriteIndexFile.mockResolvedValue({ fileId: 'index-1' } as never);

    const items = Array.from({ length: 50 }, (_, i) => ({ source: 'gmail', id: `id-${i + 1}` }));
    (drive.files.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        id: 'set-1',
        name: 'Big set',
        createdAtISO: '2024-01-01T00:00:00.000Z',
        updatedAtISO: '2024-01-01T00:00:00.000Z',
        items,
        version: 1,
        driveFolderId: 'folder-1',
        driveFileId: 'set-1',
      },
    });

    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub-model' },
      provider: { summarize: vi.fn().mockResolvedValue({ summary: 'S', highlights: [], model: 'stub-model' }) },
    } as never);
    mockFetchGmailMessageText.mockResolvedValue({ title: 'Mail', text: 'hello', metadata: {} });
    mockWriteArtifactToDrive.mockResolvedValue({ jsonFileId: 'summary-id', jsonWebViewLink: 'https://drive/s' } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize-missing', {
        method: 'POST',
        body: JSON.stringify({ selectionSetId: 'set-1', limit: 5, sourceFilter: 'all' }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.requested).toBe(5);
    expect(payload.summarized).toBe(5);
    expect(mockWriteArtifactToDrive).toHaveBeenCalledTimes(5);
  });

  it('skips already summarized items', async () => {
    const drive = makeDrive();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockCreateGmailClient.mockReturnValue({} as never);
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({ summaries: [{ source: 'gmail', sourceId: 'id-1', driveFileId: 'sum-1' }] } as never);
    (drive.files.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        id: 'set-1',
        name: 'Set',
        createdAtISO: '2024-01-01T00:00:00.000Z',
        updatedAtISO: '2024-01-01T00:00:00.000Z',
        items: [
          { source: 'gmail', id: 'id-1' },
          { source: 'gmail', id: 'id-2' },
        ],
        version: 1,
        driveFolderId: 'folder-1',
        driveFileId: 'set-1',
      },
    });

    mockGetTimelineProviderFromDrive.mockResolvedValue({
      settings: { provider: 'stub', model: 'stub-model' },
      provider: { summarize: vi.fn().mockResolvedValue({ summary: 'S', highlights: [], model: 'stub-model' }) },
    } as never);
    mockFetchGmailMessageText.mockResolvedValue({ title: 'Mail', text: 'hello', metadata: {} });
    mockWriteArtifactToDrive.mockResolvedValue({ jsonFileId: 'summary-id', jsonWebViewLink: 'https://drive/s' } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize-missing', {
        method: 'POST',
        body: JSON.stringify({ selectionSetId: 'set-1', limit: 10, sourceFilter: 'all' }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.skippedAlreadySummarized).toBe(1);
    expect(payload.requested).toBe(1);
    expect(mockWriteArtifactToDrive).toHaveBeenCalledTimes(1);
  });

  it('returns forbidden when selection set driveFolderId does not match session folder', async () => {
    const drive = makeDrive();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockCreateGmailClient.mockReturnValue({} as never);
    (drive.files.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        id: 'set-1',
        name: 'Set',
        createdAtISO: '2024-01-01T00:00:00.000Z',
        updatedAtISO: '2024-01-01T00:00:00.000Z',
        items: [{ source: 'gmail', id: 'id-1' }],
        version: 1,
        driveFolderId: 'folder-2',
        driveFileId: 'set-1',
      },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize-missing', {
        method: 'POST',
        body: JSON.stringify({ selectionSetId: 'set-1' }),
      }) as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'forbidden', message: 'Selection set is not in the app folder.' },
      error_code: 'forbidden',
    });
  });


  it('returns ApiError-shaped 404 when selection set is missing', async () => {
    const drive = makeDrive();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockCreateGmailClient.mockReturnValue({} as never);
    (drive.files.get as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 404 });

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize-missing', {
        method: 'POST',
        body: JSON.stringify({ selectionSetId: 'missing-set' }),
      }) as never,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: 'Selection set not found.' },
      error_code: 'not_found',
    });
  });
});
