import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { POST } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDrive = vi.mocked(createDriveClient);

const baseArtifact = {
  artifactId: 'a1', source: 'drive', sourceId: 'src-1', title: 'A1',
  createdAtISO: '2026-01-01T00:00:00.000Z', summary: 'Summary', highlights: ['h'],
  driveFolderId: 'folder-1', driveFileId: 'file-1', model: 'stub', version: 1,
};

describe('POST /api/timeline/quality/apply-annotation', () => {
  it('merges patch, trims, and clears fields', async () => {
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'a@b.c' } } as never);
    mockAccessToken.mockResolvedValue('token');

    const get = vi.fn().mockResolvedValue({ data: { ...baseArtifact, userAnnotations: { location: 'Old place' } } });
    const update = vi.fn().mockResolvedValue({ data: { id: 'file-1' } });
    mockCreateDrive.mockReturnValue({ files: { get, update } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/quality/apply-annotation', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'file-1', patch: { entities: [' Alice ', 'Bob'], location: '', amount: ' £1200 ' } }),
    }) as never);

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.userAnnotations.entities).toEqual(['Alice', 'Bob']);
    expect(payload.userAnnotations.amount).toBe('£1200');
    expect(payload.userAnnotations.location).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
