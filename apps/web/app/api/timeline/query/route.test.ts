import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({ getGoogleSession: vi.fn(), getGoogleAccessToken: vi.fn() }));
vi.mock('../../../lib/googleDrive', () => ({ createDriveClient: vi.fn() }));
vi.mock('../../../lib/timeline/artifactIndex', () => ({ loadArtifactIndex: vi.fn() }));
vi.mock('../../../lib/entities/aliases', () => ({ readEntityAliasesFromDrive: vi.fn() }));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';
import { readEntityAliasesFromDrive } from '../../../lib/entities/aliases';
import { POST } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDrive = vi.mocked(createDriveClient);
const mockLoad = vi.mocked(loadArtifactIndex);
const mockAliases = vi.mocked(readEntityAliasesFromDrive);

describe('POST /api/timeline/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockToken.mockResolvedValue('token');
    mockAliases.mockResolvedValue({ aliases: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', aliases: [{ alias: 'ibm', canonical: 'acme' }] } } as never);
  });

  it('returns 401 without auth', async () => {
    mockSession.mockResolvedValue(null as never);
    const response = await POST(new Request('http://localhost/api/timeline/query', { method: 'POST', body: '{}' }) as never);
    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid body', async () => {
    const response = await POST(new Request('http://localhost/api/timeline/query', { method: 'POST', body: '{' }) as never);
    expect(response.status).toBe(400);
  });

  it('filters by alias entity, risk severity, kind and open loop due date', async () => {
    mockLoad.mockResolvedValue({ fileId: 'idx', index: { version: 1, updatedAtISO: '2026-01-02T00:00:00Z', artifacts: [
      { id: 'a1', driveFileId: 'f1', kind: 'summary', contentDateISO: '2026-01-02T00:00:00Z', entities: [{ name: 'acme' }], openLoopsCount: 1, risksCount: 1 },
      { id: 'a2', driveFileId: 'f2', kind: 'synthesis', contentDateISO: '2026-01-02T00:00:00Z', entities: [{ name: 'beta' }], openLoopsCount: 1, risksCount: 1 },
    ] } } as never);

    const get = vi.fn().mockResolvedValue({ data: {
      artifactId: 'a1', source: 'gmail', sourceId: '1', title: 'A1', createdAtISO: '2026-01-02T00:00:00Z', summary: 'S', highlights: ['h'],
      entities: [{ name: 'Acme' }], openLoops: [{ text: 'Loop', status: 'open', dueDateISO: '2026-01-03T00:00:00Z' }], risks: [{ text: 'Risk', severity: 'high' }], decisions: [{ text: 'Dec' }],
      driveFolderId: 'folder-1', driveFileId: 'f1', model: 'm', version: 1,
    } });
    mockDrive.mockReturnValue({ files: { get } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'IBM', riskSeverity: 'high', kind: ['summary'], openLoopStatus: 'open', openLoopDueFromISO: '2026-01-01T00:00:00Z' }),
    }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.results).toHaveLength(1);
    expect(payload.query.entity).toBe('acme');
  });

  it('keeps drive reads bounded by cap', async () => {
    mockLoad.mockResolvedValue({ fileId: 'idx', index: { version: 1, updatedAtISO: '2026-01-02T00:00:00Z', artifacts: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, driveFileId: `f${i}`, contentDateISO: '2026-01-02T00:00:00Z' })) } } as never);
    const get = vi.fn().mockResolvedValue({ data: { artifactId: 'x', source: 'gmail', sourceId: '1', title: 'A', createdAtISO: '2026-01-01T00:00:00Z', summary: 'S', highlights: ['h'], driveFolderId: 'folder', driveFileId: 'x', model: 'm', version: 1 } });
    mockDrive.mockReturnValue({ files: { get } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/query', { method: 'POST', body: JSON.stringify({ limitArtifacts: 5 }) }) as never);
    expect(response.status).toBe(200);
    expect(get.mock.calls.length).toBeLessThanOrEqual(15);
  });
});
