import { describe, expect, it, vi } from 'vitest';

import { channelMarkerName, existsMarker, writeMarker } from './channelMarkers';

describe('channelMarkers', () => {
  it('uses per-channel marker naming format', () => {
    expect(channelMarkerName('slack', 'job:window', 'p1', 'TEAM_A')).toContain('slack_sent_job_window__p1__TEAM_A');
    expect(channelMarkerName('webhook', 'job:window', 'broadcast', 'OPS')).toContain('__broadcast__OPS');
  });

  it('checks and writes markers', async () => {
    const list = vi.fn().mockResolvedValue({ data: { files: [{ id: 'f1' }] } });
    const create = vi.fn().mockResolvedValue({ data: { id: 'f2' } });
    const drive = { files: { list, create } };

    await expect(existsMarker({ drive: drive as never, folderId: 'folder', type: 'slack', runKey: 'rk', recipientKey: 'p1', targetKey: 'TEAM_A' })).resolves.toBe(true);
    await writeMarker({
      drive: drive as never,
      folderId: 'folder',
      type: 'webhook',
      runKey: 'rk',
      recipientKey: 'broadcast',
      targetKey: 'OPS',
      details: { runKey: 'rk', recipientKey: 'broadcast', targetKey: 'OPS', sentAtISO: '2026-01-01T00:00:00Z' },
    });

    expect(create).toHaveBeenCalled();
  });
});
