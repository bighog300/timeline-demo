import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../timeline/summarize/route', () => ({
  summarizeTimelineItems: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { summarizeTimelineItems } from '../../timeline/summarize/route';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockSummarizeTimelineItems = vi.mocked(summarizeTimelineItems);

const createMockDrive = () => ({
  files: {
    create: vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'text-file-id' } })
      .mockResolvedValueOnce({ data: { id: 'meta-file-id' } }),
  },
});

const makeResponse = ({ body, contentType = 'text/html' }: { body: string; contentType?: string }) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });

describe('POST /api/ingest/url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'test@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
  });

  it('stores files and summarizes by default for valid html', async () => {
    const drive = createMockDrive();
    mockCreateDriveClient.mockReturnValue(drive as never);
    mockSummarizeTimelineItems.mockResolvedValue({ payload: { artifacts: [{ artifactId: 'drive:text-file-id' }], failed: [] } } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeResponse({ body: `<html><head><title>Demo</title></head><body><article>${'hello '.repeat(80)}</article></body></html>` }),
      ),
    );

    const response = await POST(
      new Request('http://localhost/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/demo' }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.source.driveTextFileId).toBe('text-file-id');
    expect(payload.artifactId).toBe('drive:text-file-id');
    expect(mockSummarizeTimelineItems).toHaveBeenCalledTimes(1);
  });

  it('returns source only when summarize=false', async () => {
    const drive = createMockDrive();
    mockCreateDriveClient.mockReturnValue(drive as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: `<html><body><article>${'hello '.repeat(80)}</article></body></html>` })));

    const response = await POST(
      new Request('http://localhost/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/no-summary', summarize: false }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.artifactId).toBeUndefined();
    expect(mockSummarizeTimelineItems).not.toHaveBeenCalled();
  });

  it('blocks localhost urls', async () => {
    const response = await POST(
      new Request('http://localhost/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'http://localhost:3000/private' }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'url_not_allowed' });
  });

  it('rejects unsupported content type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: '{}', contentType: 'application/json' })));

    const response = await POST(
      new Request('http://localhost/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/file.json' }),
      }) as never,
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'unsupported_content_type' });
  });

  it('rejects too-large content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: 'a'.repeat(1_600_000), contentType: 'text/plain' })));

    const response = await POST(
      new Request('http://localhost/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/large.txt' }),
      }) as never,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'content_too_large' });
  });

  it('rejects insufficient extracted text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: '<html><body><article>short text</article></body></html>' })));

    const response = await POST(
      new Request('http://localhost/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/short' }),
      }) as never,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'insufficient_text' });
  });

  it('returns timeout error when fetch aborts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')));

    const response = await POST(
      new Request('http://localhost/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/timeout' }),
      }) as never,
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ error_code: 'fetch_timeout' });
  });
});
