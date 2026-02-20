import { NextResponse, type NextRequest } from 'next/server';
import { DriveSummaryJsonSchema, isoDateString } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { readAdminSettingsFromDrive } from '../../../../lib/adminSettingsDrive';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../../../../lib/googleRequest';
import { getTimelineProviderForResolved } from '../../../../lib/llm/providerRouter';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../../lib/requestContext';
import { hashUserHint, logInfo } from '../../../../lib/logger';
import { loadArtifactIndex } from '../../../../lib/timeline/artifactIndex';

const RequestSchema = z.object({ artifactId: z.string().min(1) }).strict();

const CandidateSchema = z.object({
  dateISO: isoDateString,
  confidence: z.enum(['high', 'medium', 'low']),
  source: z.enum(['contentDateISO', 'sourceMetadata', 'text_regex', 'llm']),
  evidenceSnippet: z.string().optional(),
}).strict();

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

const normalizeDateOnly = (value: string): string | null => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!dateOnly) return null;
  const iso = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00.000Z`;
  return isoDateString.safeParse(iso).success ? iso : null;
};

const clipSnippet = (text: string, index: number, length: number) => {
  const start = Math.max(0, index - 35);
  const end = Math.min(text.length, index + length + 35);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
};

const extractRegexCandidates = (text: string) => {
  const candidates: Array<{ dateISO: string; evidenceSnippet: string }> = [];
  const seen = new Set<string>();

  const push = (value: string, idx: number, len: number) => {
    const normalized = normalizeDateOnly(value);
    if (!normalized || seen.has(normalized) || candidates.length >= 3) return;
    seen.add(normalized);
    candidates.push({ dateISO: normalized, evidenceSnippet: clipSnippet(text, idx, len) });
  };

  const isoRegex = /\b(\d{4}-\d{2}-\d{2})\b/g;
  for (const match of text.matchAll(isoRegex)) {
    push(match[1], match.index ?? 0, match[0].length);
  }

  const dmyRegex = /\b([0-3]?\d)[\/\-]([01]?\d)[\/\-]((?:19|20)\d{2})\b/g;
  for (const match of text.matchAll(dmyRegex)) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    push(`${match[3]}-${month}-${day}`, match.index ?? 0, match[0].length);
  }

  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthRegex = new RegExp(`\\b(${monthNames.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+((?:19|20)\\d{2})\\b`, 'gi');
  for (const match of text.matchAll(monthRegex)) {
    const month = String(monthNames.indexOf(match[1].toLowerCase()) + 1).padStart(2, '0');
    const day = match[2].padStart(2, '0');
    push(`${match[3]}-${month}-${day}`, match.index ?? 0, match[0].length);
  }

  return candidates;
};

const maybeLlmCandidate = async (artifact: z.infer<typeof DriveSummaryJsonSchema>, drive: ReturnType<typeof createDriveClient>) => {
  try {
    const { settings } = await readAdminSettingsFromDrive(drive, artifact.driveFolderId);
    const resolved = settings.routing.tasks?.summarize ?? settings.routing.default;
    if (resolved.provider === 'stub') return null;

    const provider = getTimelineProviderForResolved(resolved);
    const prompt = [
      'Extract ONE best content date from this artifact.',
      'Return JSON with {"dateISO": string|null, "confidence": "high"|"medium"|"low", "evidenceSnippet": string, "rationale": string}.',
      'The evidenceSnippet must be a direct quote from provided text. No guessing.',
      `Title: ${artifact.title}`,
      `Summary: ${artifact.summary}`,
      `Source preview: ${artifact.sourcePreview ?? ''}`,
      `Highlights: ${(artifact.highlights ?? []).join(' | ')}`,
      `Evidence: ${(artifact.evidence ?? []).map((item) => item.excerpt).join(' | ')}`,
    ].join('\n');

    const output = await provider.timelineChat({
      query: prompt,
      artifacts: [{ artifactId: artifact.driveFileId, title: artifact.title, summary: artifact.summary, highlights: artifact.highlights, contentDateISO: artifact.contentDateISO }],
    }, { ...settings, routing: { ...settings.routing, default: resolved } });

    const parsed = z.object({
      dateISO: z.string().nullable(),
      confidence: z.enum(['high', 'medium', 'low']).optional(),
      evidenceSnippet: z.string().optional(),
      rationale: z.string().optional(),
    }).safeParse(JSON.parse(output.answer));

    if (!parsed.success || !parsed.data.dateISO) return null;
    if (!isoDateString.safeParse(parsed.data.dateISO).success) return null;

    return CandidateSchema.parse({
      dateISO: parsed.data.dateISO,
      confidence: parsed.data.confidence ?? 'low',
      source: 'llm',
      evidenceSnippet: parsed.data.evidenceSnippet,
    });
  } catch {
    return null;
  }
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/quality/date-candidates');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();
  if (!session || !accessToken) return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  if (!session.driveFolderId) return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';
  const rate = checkRateLimit(getRateLimitKey(request, session), { limit: 30, windowMs: 60_000 }, ctx);
  if (!rate.allowed) return respond(jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.'));

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);
  let fileId = body.artifactId;

  let artifactResponse: { data: unknown };
  try {
    artifactResponse = await withRetry((signal) => withTimeout((timeoutSignal) =>
      drive.files.get({ fileId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ));
  } catch {
    const loaded = await loadArtifactIndex(drive, session.driveFolderId, ctx);
    const fromIndex = loaded.index.artifacts.find((entry) => entry.id === body.artifactId);
    if (!fromIndex) return respond(jsonError(404, 'not_found', 'Artifact not found.'));
    fileId = fromIndex.driveFileId;
    try {
      artifactResponse = await withRetry((signal) => withTimeout((timeoutSignal) =>
        drive.files.get({ fileId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ));
    } catch {
      return respond(jsonError(404, 'not_found', 'Artifact not found.'));
    }
  }

  const parsed = DriveSummaryJsonSchema.safeParse(parseDriveJson(artifactResponse.data));
  if (!parsed.success) return respond(jsonError(400, 'invalid_request', 'Artifact data was invalid.'));

  const artifact = parsed.data;
  const candidates: z.infer<typeof CandidateSchema>[] = [];
  const pushCandidate = (candidate: z.infer<typeof CandidateSchema>) => {
    if (candidates.some((item) => item.dateISO === candidate.dateISO && item.source === candidate.source)) return;
    candidates.push(candidate);
  };

  if (artifact.contentDateISO) {
    pushCandidate({ dateISO: artifact.contentDateISO, confidence: 'high', source: 'contentDateISO' });
    return respond(NextResponse.json({ artifactId: fileId, candidates }));
  }

  if (artifact.sourceMetadata?.dateISO) {
    pushCandidate({
      dateISO: artifact.sourceMetadata.dateISO,
      confidence: 'high',
      source: 'sourceMetadata',
      evidenceSnippet: 'sourceMetadata.dateISO',
    });
  }

  const textSource = [artifact.summary, artifact.sourcePreview ?? '', artifact.highlights.join(' | '), ...(artifact.evidence ?? []).map((item) => item.excerpt)]
    .filter(Boolean)
    .join('\n');

  extractRegexCandidates(textSource).forEach((candidate) => pushCandidate({
    dateISO: candidate.dateISO,
    confidence: 'medium',
    source: 'text_regex',
    evidenceSnippet: candidate.evidenceSnippet,
  }));

  if (candidates.length === 0) {
    const llmCandidate = await maybeLlmCandidate(artifact, drive);
    if (llmCandidate) pushCandidate(llmCandidate);
  }

  return respond(NextResponse.json({ artifactId: fileId, candidates }));
};
