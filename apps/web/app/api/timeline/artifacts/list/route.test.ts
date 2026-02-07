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
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { findIndexFile, readIndexFile } from '../../../../lib/indexDrive';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockFindIndexFile = vi.mocked(findIndexFile);
const mockReadIndexFile = vi.mocked(readIndexFile);

const buildRequest = (url: string) => {
  const request = new Request(url) as never;
  (request as { nextUrl?: URL }).nextUrl = new URL(url);
  return request;
};

const buildArtifact = (overrides: Partial<Record<string, string>> = {}) => ({
  artifactId: overrides.artifactId ?? 'drive:file-1',
  source: 'drive',
  sourceId: overrides.sourceId ?? 'file-1',
  title: overrides.title ?? 'Summary',
  createdAtISO: overrides.createdAtISO ?? '2024-01-01T00:00:00Z',
  summary: overrides.summary ?? 'Summary content',
  driveFolderId: overrides.driveFolderId ?? 'folder-1',
  driveFileId: overrides.driveFileId ?? 'file-1',
  driveWebViewLink: overrides.driveWebViewLink ?? 'https://drive.google.com/file-1',
});

describe('GET /api/timeline/artifacts/list', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await GET(buildRequest('http://localhost/api/timeline/artifacts/list'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'reconnect_required',
        message: 'Reconnect required.',
      },
      error_code: 'reconnect_required',
    });
  });

  it('falls back to full sync when since is invalid', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockFindIndexFile.mockResolvedValue(null);

    const listSpy = vi.fn().mockResolvedValue({
      data: { files: [], nextPageToken: undefined },
    });
    mockCreateDriveClient.mockReturnValue({
      files: { list: listSpy, get: vi.fn() },
    } as never);

    const response = await GET(
      buildRequest('http://localhost/api/timeline/artifacts/list?since=not-a-date'),
    );

    expect(response.status).toBe(200);
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "'folder-1' in parents and trashed=false",
      }),
      expect.any(Object),
    );
  });

  it('uses the base list query when since is omitted', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockFindIndexFile.mockResolvedValue(null);

    const listSpy = vi.fn().mockResolvedValue({
      data: { files: [], nextPageToken: undefined },
    });
    mockCreateDriveClient.mockReturnValue({
      files: { list: listSpy, get: vi.fn() },
    } as never);

    const response = await GET(buildRequest('http://localhost/api/timeline/artifacts/list'));

    expect(response.status).toBe(200);
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "'folder-1' in parents and trashed=false",
      }),
      expect.any(Object),
    );
  });

  it('adds a modifiedTime filter when since is valid', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockFindIndexFile.mockResolvedValue(null);

    const listSpy = vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: 'file-1',
            name: 'Summary - Summary.json',
            mimeType: 'application/json',
            modifiedTime: '2024-02-01T00:00:00Z',
          },
        ],
        nextPageToken: undefined,
      },
    });
    const getSpy = vi.fn().mockResolvedValue({ data: buildArtifact() });
    mockCreateDriveClient.mockReturnValue({
      files: { list: listSpy, get: getSpy },
    } as never);

    const sinceISO = '2024-01-15T00:00:00Z';
    const normalizedSince = new Date(sinceISO).toISOString();
    const response = await GET(
      buildRequest(`http://localhost/api/timeline/artifacts/list?since=${sinceISO}`),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.artifacts).toHaveLength(1);
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        q: `'folder-1' in parents and trashed=false and modifiedTime > '${normalizedSince}'`,
      }),
      expect.any(Object),
    );
  });

  it('filters index summaries based on since', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({
      version: 1,
      updatedAtISO: '2024-03-01T00:00:00Z',
      driveFolderId: 'folder-1',
      indexFileId: 'index-1',
      summaries: [
        {
          driveFileId: 'file-1',
          title: 'Old summary',
          source: 'drive',
          sourceId: 'file-1',
          updatedAtISO: '2024-01-01T00:00:00Z',
        },
        {
          driveFileId: 'file-2',
          title: 'New summary',
          source: 'drive',
          sourceId: 'file-2',
          updatedAtISO: '2024-02-10T00:00:00Z',
        },
      ],
      selectionSets: [],
    } as never);

    const getSpy = vi.fn().mockResolvedValue({ data: buildArtifact({ driveFileId: 'file-2' }) });
    mockCreateDriveClient.mockReturnValue({
      files: { list: vi.fn(), get: getSpy },
    } as never);

    const response = await GET(
      buildRequest('http://localhost/api/timeline/artifacts/list?since=2024-02-01T00:00:00Z'),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.fromIndex).toBe(true);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].id).toBe('file-2');
    expect(getSpy).toHaveBeenCalledWith(
      { fileId: 'file-2', alt: 'media' },
      expect.objectContaining({ responseType: 'json' }),
    );
  });
});
