import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({ getGoogleSession: vi.fn(), getGoogleAccessToken: vi.fn() }));
vi.mock('../../../lib/googleDrive', () => ({ createDriveClient: vi.fn() }));
vi.mock('../../../lib/timeline/artifactIndex', () => ({ loadArtifactIndex: vi.fn() }));
vi.mock('../synthesize/route', () => ({ POST: vi.fn() }));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';
import { POST } from './route';
import { POST as synthesizePost } from '../synthesize/route';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDrive = vi.mocked(createDriveClient);
const mockLoad = vi.mocked(loadArtifactIndex);
const mockSynthesize = vi.mocked(synthesizePost);

describe('POST /api/timeline/week-in-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockToken.mockResolvedValue('token');
    mockLoad.mockResolvedValue({ fileId: 'idx', index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1' }] } } as never);
    mockSynthesize.mockResolvedValue(new Response(JSON.stringify({ ok: true, synthesis: { content: 'weekly' }, citations: [], savedArtifactId: 'syn-1' }), { status: 200 }) as never);
    mockDrive.mockReturnValue({ files: { get: vi.fn().mockResolvedValue({ data: { artifactId: 'a1', source: 'gmail', sourceId: '1', title: 'A1', createdAtISO: '2026-01-01T00:00:00Z', summary: 'S', highlights: ['h'], driveFolderId: 'folder-1', driveFileId: 'f1', model: 'm', version: 1 } }), create: vi.fn().mockResolvedValue({ data: { id: 'report-1', name: 'week.md' } }) } } as never);
  });

  it('uses default date range and returns report by default', async () => {
    const res = await POST(new Request('http://localhost/api/timeline/week-in-review', { method: 'POST', body: '{}' }) as never);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.dateFromISO).toBeDefined();
    expect(payload.report.driveFileId).toBe('report-1');
    expect(mockSynthesize).toHaveBeenCalled();
  });

  it('respects exportReport false', async () => {
    const res = await POST(new Request('http://localhost/api/timeline/week-in-review', { method: 'POST', body: JSON.stringify({ exportReport: false }) }) as never);
    const payload = await res.json();
    expect(payload.report).toBeUndefined();
  });

  it('handles auth and invalid', async () => {
    mockSession.mockResolvedValue(null as never);
    const unauth = await POST(new Request('http://localhost/api/timeline/week-in-review', { method: 'POST', body: '{}' }) as never);
    expect(unauth.status).toBe(401);

    mockSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    const invalid = await POST(new Request('http://localhost/api/timeline/week-in-review', { method: 'POST', body: '{' }) as never);
    expect(invalid.status).toBe(400);
  });

  it('passes saveToTimeline toggle to synthesis request', async () => {
    await POST(new Request('http://localhost/api/timeline/week-in-review', { method: 'POST', body: JSON.stringify({ saveToTimeline: false }) }) as never);
    const calledReq = mockSynthesize.mock.calls[0][0] as Request;
    const body = await calledReq.json();
    expect(body.saveToTimeline).toBe(false);
  });
});
