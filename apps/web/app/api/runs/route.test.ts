import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../lib/runArtifacts', () => ({
  buildRunArtifact: vi.fn(),
  listRunArtifacts: vi.fn(),
  writeRunArtifactStart: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createDriveClient } from '../../lib/googleDrive';
import { buildRunArtifact, listRunArtifacts, writeRunArtifactStart } from '../../lib/runArtifacts';
import { GET, POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockBuildRunArtifact = vi.mocked(buildRunArtifact);
const mockListRunArtifacts = vi.mocked(listRunArtifacts);
const mockWriteRunArtifactStart = vi.mocked(writeRunArtifactStart);

describe('/api/runs', () => {
  it('returns reconnect_required when session is missing', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/runs') as never);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'reconnect_required', message: 'Reconnect required.' },
      error_code: 'reconnect_required',
    });
  });

  it('GET returns normalized run list', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockListRunArtifacts.mockResolvedValue([
      {
        kind: 'selection_set_run',
        version: 1,
        id: 'run-1',
        selectionSet: {
          id: 'set-1',
          title: 'Invoices',
          source: 'gmail',
          kind: 'gmail_selection_set',
          query: { q: 'from:a@example.com' },
        },
        action: 'summarize',
        startedAt: '2025-01-01T00:00:00.000Z',
        finishedAt: '2025-01-01T00:01:00.000Z',
        caps: { maxPages: 5, maxItems: 50, pageSize: 50, batchSize: 10 },
        result: {
          status: 'partial_success',
          foundCount: 50,
          processedCount: 40,
          failedCount: 10,
          requestIds: ['req-1'],
          note: null,
        },
        items: { ids: null, idsIncluded: false },
      },
    ] as never);

    const response = await GET(new Request('http://localhost/api/runs?limit=10') as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      runs: [
        {
          id: 'run-1',
          action: 'summarize',
          status: 'partial_success',
          selectionSet: {
            id: 'set-1',
            title: 'Invoices',
            source: 'gmail',
            kind: 'gmail_selection_set',
            query: { q: 'from:a@example.com' },
          },
          startedAt: '2025-01-01T00:00:00.000Z',
          finishedAt: '2025-01-01T00:01:00.000Z',
          counts: { foundCount: 50, processedCount: 40, failedCount: 10 },
          requestIds: ['req-1'],
          artifact: {
            kind: 'selection_set_run',
            version: 1,
            id: 'run-1',
            selectionSet: {
              id: 'set-1',
              title: 'Invoices',
              source: 'gmail',
              kind: 'gmail_selection_set',
              query: { q: 'from:a@example.com' },
            },
            action: 'summarize',
            startedAt: '2025-01-01T00:00:00.000Z',
            finishedAt: '2025-01-01T00:01:00.000Z',
            caps: { maxPages: 5, maxItems: 50, pageSize: 50, batchSize: 10 },
            result: {
              status: 'partial_success',
              foundCount: 50,
              processedCount: 40,
              failedCount: 10,
              requestIds: ['req-1'],
              note: null,
            },
            items: { ids: null, idsIncluded: false },
          },
        },
      ],
    });
  });

  it('POST writes run artifact start', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockBuildRunArtifact.mockReturnValue({ id: 'run-1' } as never);
    mockWriteRunArtifactStart.mockResolvedValue({ runId: 'run-1', fileId: 'file-1' });

    const response = await POST(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'run',
          selectionSet: {
            id: 'set-1',
            title: 'Invoices',
            source: 'gmail',
            kind: 'gmail_selection_set',
            query: { q: 'from:a@example.com' },
          },
          caps: { maxPages: 1, maxItems: 50, pageSize: 50, batchSize: 10 },
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runId: 'run-1', fileId: 'file-1' });
  });
});
