import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import { sanitizeDriveFileName } from '../../../lib/driveSafety';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../../../lib/googleRequest';
import { hashUserHint, logInfo } from '../../../lib/logger';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { summarizeTimelineItems } from '../../timeline/summarize/route';

const RequestSchema = z
  .object({
    url: z.string().url(),
    titleHint: z.string().trim().max(200).optional(),
    summarize: z.boolean().default(true),
    tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  })
  .strict();

const ResponseSchema = z
  .object({
    ok: z.literal(true),
    url: z.string().url(),
    source: z
      .object({
        sourceId: z.string(),
        driveTextFileId: z.string(),
        driveMetaFileId: z.string(),
        title: z.string().optional(),
        fetchedAtISO: z.string(),
        contentBytes: z.number().int().nonnegative(),
      })
      .strict(),
    artifactId: z.string().optional(),
  })
  .strict();

const MAX_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 10_000;
const MIN_TEXT_CHARS = 300;
const MAX_TEXT_CHARS = 80_000;

const PRIVATE_HOST_PATTERNS = [/^localhost$/i, /\.local$/i];

const toSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const datePart = (date = new Date()) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
};

const isPrivateIpv4 = (host: string) => {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const isPrivateIpv6 = (host: string) => {
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
};

const isBlockedHostname = (hostname: string) => {
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return isPrivateIpv4(hostname);
  }

  if (hostname.includes(':')) {
    return isPrivateIpv6(hostname);
  }

  return false;
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const extractHtmlTitle = (html: string) => {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (og?.[1]) {
    return normalizeWhitespace(og[1]);
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title?.[1] ? normalizeWhitespace(title[1]) : undefined;
};

const stripTags = (html: string) => {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const withoutDangerous = withoutComments
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
  const blocks = withoutDangerous
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ');
  const plain = blocks.replace(/<[^>]+>/g, ' ');
  return normalizeWhitespace(plain.replace(/\n{3,}/g, '\n\n'));
};

const extractReadableText = (contentType: string, bodyText: string) => {
  if (contentType.startsWith('text/plain')) {
    return { text: normalizeWhitespace(bodyText), title: undefined };
  }

  const articleMatch = bodyText.match(/<article[\s\S]*?<\/article>/i);
  const bodyMatch = bodyText.match(/<body[\s\S]*?<\/body>/i);
  const region = articleMatch?.[0] ?? bodyMatch?.[0] ?? bodyText;
  const text = stripTags(region);
  return {
    text,
    title: extractHtmlTitle(bodyText),
  };
};

const sanitizeLogUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value;
  }
};

const readBodyWithLimit = async (response: Response, limit: number) => {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      throw new Error('content_too_large');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
};

const createDriveFile = async (
  drive: ReturnType<typeof createDriveClient>,
  folderId: string,
  name: string,
  mimeType: string,
  body: string,
) => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: {
              name,
              parents: [folderId],
              mimeType,
            },
            media: {
              mimeType,
              body,
            },
            fields: 'id',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return response.data.id ?? '';
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/ingest/url');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 10, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', { retryAfterMs: rateStatus.resetMs }));
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const { url, titleHint, summarize } = parsed.data;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid URL.'));
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || isBlockedHostname(parsedUrl.hostname)) {
    return respond(jsonError(400, 'url_not_allowed', 'URL is not allowed.'));
  }

  const fetchStarted = Date.now();
  const fetchController = new AbortController();
  const timeoutId = setTimeout(() => fetchController.abort(), FETCH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: fetchController.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    return respond(jsonError(504, 'fetch_timeout', 'URL fetch timed out.'));
  }

  clearTimeout(timeoutId);

  const redirected = response.url ? new URL(response.url) : parsedUrl;
  if (isBlockedHostname(redirected.hostname)) {
    return respond(jsonError(400, 'url_not_allowed', 'URL is not allowed.'));
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!(contentType.startsWith('text/html') || contentType.startsWith('text/plain'))) {
    return respond(jsonError(415, 'unsupported_content_type', 'Unsupported content type.'));
  }

  let rawBody: string;
  try {
    rawBody = await readBodyWithLimit(response, MAX_BYTES);
  } catch {
    return respond(jsonError(413, 'content_too_large', 'Content is too large.'));
  }

  const { text: extractedText, title: extractedTitle } = extractReadableText(contentType, rawBody);
  if (extractedText.length < MIN_TEXT_CHARS) {
    return respond(jsonError(422, 'insufficient_text', 'Insufficient readable text extracted.'));
  }

  const clampedText = extractedText.slice(0, MAX_TEXT_CHARS);
  const fetchedAtISO = new Date().toISOString();
  const sourceId = createHash('sha256').update(parsedUrl.toString()).digest('hex').slice(0, 24);
  const drive = createDriveClient(accessToken);
  const slug = toSlug(titleHint ?? extractedTitle ?? parsedUrl.hostname) || 'source';
  const baseName = sanitizeDriveFileName(`ingest_url_${datePart()}_${slug}`, `ingest_url_${datePart()}_source`);

  const meta = {
    version: 1,
    sourceType: 'url' as const,
    url: parsedUrl.toString(),
    finalUrl: redirected.toString(),
    title: titleHint ?? extractedTitle,
    fetchedAtISO,
    contentType,
    contentBytes: new TextEncoder().encode(rawBody).length,
    extract: {
      method: 'simple_readability_v1',
      textChars: clampedText.length,
    },
  };

  const driveTextFileId = await createDriveFile(drive, driveFolderId, `${baseName}.txt`, 'text/plain', clampedText);
  const driveMetaFileId = await createDriveFile(drive, driveFolderId, `${baseName}.meta.json`, 'application/json', JSON.stringify(meta, null, 2));

  let artifactId: string | undefined;
  if (summarize) {
    const summarizeResult = await summarizeTimelineItems({
      items: [
        {
          kind: 'url',
          url: parsedUrl.toString(),
          driveTextFileId,
          driveMetaFileId,
          title: titleHint ?? extractedTitle,
        },
      ],
      session,
      accessToken,
      ctx,
    });

    if (summarizeResult.payload) {
      artifactId = summarizeResult.payload.artifacts[0]?.artifactId;
    }
  }

  logInfo(ctx, 'url_ingest_complete', {
    urlHost: parsedUrl.hostname,
    logUrl: sanitizeLogUrl(parsedUrl.toString()),
    contentType,
    bytes: meta.contentBytes,
    textChars: clampedText.length,
    elapsedMs: Date.now() - fetchStarted,
  });

  const payload = ResponseSchema.parse({
    ok: true,
    url: parsedUrl.toString(),
    source: {
      sourceId,
      driveTextFileId,
      driveMetaFileId,
      title: titleHint ?? extractedTitle,
      fetchedAtISO,
      contentBytes: meta.contentBytes,
    },
    ...(artifactId ? { artifactId } : {}),
  });

  return respond(NextResponse.json(payload));
};
