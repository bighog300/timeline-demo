import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/indexDrive', () => ({
  findIndexFile: vi.fn(),
  readIndexFile: vi.fn(),
  writeIndexFile: vi.fn(),
}));

vi.mock('../../../../lib/llm/providerRouter', () => ({
  getTimelineProviderFromDrive: vi.fn(),
}));

vi.mock('../../../../lib/llm/contentDateExtraction', () => ({
  extractContentDate: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { extractContentDate } from '../../../../lib/llm/contentDateExtraction';
import { ProviderError } from '../../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../../lib/llm/providerRouter';
import { findIndexFile, readIndexFile, writeIndexFile } from '../../../../lib/indexDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockGetTimelineProviderFromDrive = vi.mocked(getTimelineProviderFromDrive);
const mockExtractContentDate = vi.mocked(extractContentDate);
const mockFindIndexFile = vi.mocked(findIndexFile);
const mockReadIndexFile = vi.mocked(readIndexFile);
const mockWriteIndexFile = vi.mocked(writeIndexFile);

const summaryPayload = (overrides: Record<string, unknown> = {}) => ({
  artifactId: 'drive:src-1',
  source: 'drive',
  sourceId: 'src-1',
  title: 'Summary one',
  createdAtISO: '2024-01-01T00:00:00.000Z',
  summary: 'Concise summary',
  highlights: ['A'],
  driveFolderId: 'folder-1',
  driveFileId: 'summary-1',
  model: 'stub',
  version: 1,
  type: 'summary',
  status: 'complete',
  id: 'summary-1',
  updatedAtISO: '2024-01-01T00:00:00.000Z',
  meta: {
    driveFileId: 'summary-1',
    driveFolderId: 'folder-1',
    source: 'drive',
    sourceId: 'src-1',
    model: 'stub',
    version: 1,
  },
  ...overrides,
});

describe('POST /api/timeline/artifacts/backfill-content-dates', () => {
  it('returns 400 for invalid body', async () => {
    const response = await POST(new Request('http://localhost/api/timeline/artifacts/backfill-content-dates', {
      method: 'POST',
      body: JSON.stringify({ limit: 0 }),
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'bad_request', message: 'Invalid request payload.' },
      error_code: 'bad_request',
    });
  });

  it('dryRun does not write but reports update', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({
      version: 1,
      updatedAtISO: '2024-01-01T00:00:00.000Z',
      driveFolderId: 'folder-1',
      indexFileId: 'index-1',
      summaries: [{ driveFileId: 'summary-1', title: 'Summary one', source: 'drive', sourceId: 'src-1' }],
      selectionSets: [],
      stats: { totalSummaries: 1, totalSelectionSets: 0 },
    } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({
      provider: {} as never,
      settings: { provider: 'stub' },
    } as never);
    mockExtractContentDate.mockResolvedValue({ contentDateISO: '2024-05-01T00:00:00.000Z' });

    const getMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'summary-1', parents: ['folder-1'] } })
      .mockResolvedValueOnce({ data: summaryPayload() });
    const updateMock = vi.fn();
    mockCreateDriveClient.mockReturnValue({ files: { get: getMock, update: updateMock, list: vi.fn() } } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/artifacts/backfill-content-dates', {
        method: 'POST',
        body: JSON.stringify({ dryRun: true, limit: 10 }),
      }) as never,
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.updated).toBe(1);
    expect(payload.items[0].status).toBe('updated');
    expect(updateMock).not.toHaveBeenCalled();
    expect(mockWriteIndexFile).not.toHaveBeenCalled();
  });

  it('writes only artifacts missing contentDateISO', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({
      version: 1,
      updatedAtISO: '2024-01-01T00:00:00.000Z',
      driveFolderId: 'folder-1',
      indexFileId: 'index-1',
      summaries: [
        { driveFileId: 'summary-1', title: 'Summary one', source: 'drive', sourceId: 'src-1' },
        { driveFileId: 'summary-2', title: 'Summary two', source: 'drive', sourceId: 'src-2' },
      ],
      selectionSets: [],
      stats: { totalSummaries: 2, totalSelectionSets: 0 },
    } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({ provider: {} as never, settings: { provider: 'stub' } } as never);
    mockExtractContentDate.mockResolvedValue({ contentDateISO: '2024-05-01T00:00:00.000Z' });

    const getMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'summary-1', parents: ['folder-1'] } })
      .mockResolvedValueOnce({ data: summaryPayload() })
      .mockResolvedValueOnce({ data: { id: 'summary-2', parents: ['folder-1'] } })
      .mockResolvedValueOnce({ data: summaryPayload({
        artifactId: 'drive:src-2',
        sourceId: 'src-2',
        driveFileId: 'summary-2',
        id: 'summary-2',
        contentDateISO: '2024-04-01T00:00:00.000Z',
        meta: { driveFileId: 'summary-2', driveFolderId: 'folder-1', source: 'drive', sourceId: 'src-2', model: 'stub', version: 1 },
      }) });
    const updateMock = vi.fn().mockResolvedValue({ data: { id: 'summary-1' } });
    mockCreateDriveClient.mockReturnValue({ files: { get: getMock, update: updateMock, list: vi.fn() } } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/artifacts/backfill-content-dates', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false, limit: 10 }),
      }) as never,
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.updated).toBe(1);
    expect(payload.skippedAlreadyHasDate).toBe(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(mockWriteIndexFile).toHaveBeenCalledTimes(1);
  });

  it('respects max cap of 25', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({
      version: 1,
      updatedAtISO: '2024-01-01T00:00:00.000Z',
      driveFolderId: 'folder-1',
      indexFileId: 'index-1',
      summaries: [{ driveFileId: 'summary-1', title: 'Summary one', source: 'drive', sourceId: 'src-1' }],
      selectionSets: [],
      stats: { totalSummaries: 1, totalSelectionSets: 0 },
    } as never);
    mockGetTimelineProviderFromDrive.mockResolvedValue({ provider: {} as never, settings: { provider: 'stub' } } as never);
    mockCreateDriveClient.mockReturnValue({ files: { get: vi.fn(), update: vi.fn(), list: vi.fn() } } as never);

    const response = await POST(
      new Request('http://localhost/api/timeline/artifacts/backfill-content-dates', {
        method: 'POST',
        body: JSON.stringify({ limit: 30 }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'bad_request', message: 'Invalid request payload.' },
      error_code: 'bad_request',
    });
  });

  it('returns provider_not_configured when provider setup fails', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({ files: { get: vi.fn(), update: vi.fn(), list: vi.fn() } } as never);
    mockGetTimelineProviderFromDrive.mockRejectedValue(
      new ProviderError({ code: 'not_configured', status: 500, provider: 'openai', message: 'Provider not configured.' }),
    );

    const response = await POST(
      new Request('http://localhost/api/timeline/artifacts/backfill-content-dates', {
        method: 'POST',
        body: JSON.stringify({ limit: 10 }),
      }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'provider_not_configured', message: 'Selected provider is not configured.' },
      error_code: 'provider_not_configured',
    });
  });
});
