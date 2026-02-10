import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDriveQuery } from './driveQuery';

describe('buildDriveQuery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds stable query with defaults and time preset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T00:00:00.000Z'));

    const query = buildDriveQuery({
      nameContains: 'invoice',
      mimeGroup: 'pdf',
      modifiedPreset: '30d',
      modifiedAfter: null,
      inFolderId: null,
      ownerEmail: null,
    });

    expect(query).toBe(
      "trashed=false and name contains 'invoice' and mimeType='application/pdf' and modifiedTime > '2026-01-11T00:00:00.000Z'",
    );
  });

  it('supports custom date, folder id, owner, and starred', () => {
    const query = buildDriveQuery({
      nameContains: 'Roadmap',
      mimeGroup: 'doc',
      modifiedPreset: 'custom',
      modifiedAfter: '2026-02-01',
      inFolderId: 'folder-123',
      ownerEmail: 'Owner@Example.com',
      starred: true,
    });

    expect(query).toBe(
      "trashed=false and name contains 'Roadmap' and (mimeType='application/vnd.google-apps.document' or mimeType='application/msword' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document') and modifiedTime > '2026-02-01T00:00:00.000Z' and 'folder-123' in parents and 'owner@example.com' in owners and starred=true",
    );
  });

  it('escapes single quotes and backslashes in literals', () => {
    const query = buildDriveQuery({
      nameContains: "O'Reilly \\ docs",
      mimeGroup: 'any',
      modifiedPreset: 'custom',
      modifiedAfter: null,
      inFolderId: "abc'def",
      ownerEmail: "my'o@example.com",
    });

    expect(query).toBe(
      "trashed=false and name contains 'O\\'Reilly \\\\ docs' and 'abc\\'def' in parents and 'my\\'o@example.com' in owners",
    );
  });

  it('omits invalid custom date and optional empty filters', () => {
    const query = buildDriveQuery({
      nameContains: '   ',
      mimeGroup: 'folder',
      modifiedPreset: 'custom',
      modifiedAfter: 'not-a-date',
      inFolderId: '   ',
      ownerEmail: null,
    });

    expect(query).toBe("trashed=false and mimeType='application/vnd.google-apps.folder'");
  });
});
