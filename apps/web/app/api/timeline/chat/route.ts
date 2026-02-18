import { NextResponse, type NextRequest } from 'next/server';
import { SummaryArtifactSchema } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import {
  AppDriveFolderResolveError,
  resolveOrProvisionAppDriveFolder,
} from '../../../lib/appDriveFolder';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { mapGoogleError } from '../../../lib/googleRequest';
import { normalizeTimelineCitations } from '../../../lib/llm/providerOutput';
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { hashUserHint, logError, logInfo, logWarn, safeError } from '../../../lib/logger';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';

const RequestSchema = z
  .object({
    query: z.string().min(2),
    dateFromISO: z.string().optional(),
    dateToISO: z.string().optional(),
    tags: z.array(z.string()).max(10).optional(),
    participants: z.array(z.string()).max(10).optional(),
    limit: z.number().int().min(1).max(15).default(8),
  })
  .strict();

const ResponseSchema = z
  .object({
    answer: z.string(),
    citations: z.array(
      z
        .object({
          artifactId: z.string(),
          excerpt: z.string(),
          contentDateISO: z.string().optional(),
          title: z.string().optional(),
        })
        .strict(),
    ),
    usedArtifactIds: z.array(z.string()),
  })
  .strict();

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'with',
]);

const MAX_EXCERPT = 300;
const MAX_TOTAL_CHARS = 24000;
const MAX_EXCERPT_CHARS = 1200;
const MAX_SUMMARY_CHARS = 2000;

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

const toTimestamp = (value?: string) => {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
};

const scoreArtifact = (
  queryTokens: string[],
  fields: { title?: string; summary?: string; highlights?: string[] },
) => {
  if (!queryTokens.length) {
    return 0;
  }

  const title = new Set(tokenize(fields.title ?? ''));
  const summary = new Set(tokenize(fields.summary ?? ''));
  const highlights = new Set(tokenize((fields.highlights ?? []).join(' ')));

  return queryTokens.reduce((score, token) => {
    if (title.has(token)) {
      return score + 5;
    }
    if (summary.has(token)) {
      return score + 3;
    }
    if (highlights.has(token)) {
      return score + 1;
    }
    return score;
  }, 0);
};

const isWithinDateRange = (value: string | undefined, from?: string, to?: string) => {
  if (!value) return true;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return true;
  if (from && ts < new Date(from).getTime()) return false;
  if (to && ts > new Date(to).getTime()) return false;
  return true;
};

const noMatchResponse = (answer: string) =>
  NextResponse.json(
    ResponseSchema.parse({
      answer,
      citations: [],
      usedArtifactIds: [],
    }),
  );

const estimateArtifactChars = (artifact: {
  title?: string;
  summary?: string;
  highlights?: string[];
  evidence?: Array<{ excerpt: string }>;
}) => {
  const evidenceChars = (artifact.evidence ?? []).reduce((acc, item) => acc + item.excerpt.length, 0);
  return (
    (artifact.title?.length ?? 0) +
    (artifact.summary?.length ?? 0) +
    (artifact.highlights ?? []).reduce((acc, item) => acc + item.length, 0) +
    evidenceChars
  );
};

const trimTo = (value: string | undefined, maxChars: number) => {
  if (!value) {
    return undefined;
  }
  return value.length <= maxChars ? value : value.slice(0, maxChars);
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/chat');
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
  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 30, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
    }
    body = parsed.data;
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);
  let driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    try {
      const resolved = await resolveOrProvisionAppDriveFolder(drive, ctx);
      driveFolderId = resolved?.id;
    } catch (error) {
      if (error instanceof AppDriveFolderResolveError) {
        const mapped = mapGoogleError(error.cause, error.operation);
        return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
      }
      throw error;
    }
  }

  if (!driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  const { index } = await loadArtifactIndex(drive, driveFolderId, ctx);

  const filtered = index.artifacts
    .filter((artifact) => isWithinDateRange(artifact.contentDateISO, body.dateFromISO, body.dateToISO))
    .filter((artifact) => {
      if (!body.tags?.length) return true;
      const tags = new Set((artifact.tags ?? []).map((tag) => tag.toLowerCase()));
      return body.tags.some((tag) => tags.has(tag.toLowerCase()));
    })
    .filter((artifact) => {
      if (!body.participants?.length) return true;
      const participants = new Set((artifact.participants ?? []).map((p) => p.toLowerCase()));
      return body.participants.some((p) => participants.has(p.toLowerCase()));
    });

  if (filtered.length === 0) {
    return respond(
      noMatchResponse(
        'No matching timeline artifacts were found. Try broadening filters, summarizing more sources, or asking a different question.',
      ),
    );
  }

  const artifactMap = new Map(index.artifacts.map((entry) => [entry.id, entry]));
  const loadedCandidates = [] as Array<{ entry: (typeof filtered)[number]; artifact: z.infer<typeof SummaryArtifactSchema> }>;

  for (const entry of filtered) {
    try {
      const response = await drive.files.get(
        { fileId: entry.driveFileId, alt: 'media' },
        { responseType: 'json' },
      );
      const parsed = SummaryArtifactSchema.safeParse(typeof response.data === 'string' ? JSON.parse(response.data) : response.data);
      if (parsed.success) {
        loadedCandidates.push({ entry, artifact: parsed.data });
      }
    } catch (error) {
      logError(ctx, 'artifact_read_failed', { error: safeError(error) });
    }
  }

  if (loadedCandidates.length === 0) {
    return respond(
      noMatchResponse('No matching timeline artifacts were readable. Please retry after syncing.'),
    );
  }

  const queryTokens = tokenize(body.query);
  const ranked = loadedCandidates
    .map((candidate) => ({
      ...candidate,
      score: scoreArtifact(queryTokens, {
        title: candidate.entry.title ?? candidate.artifact.title,
        summary: candidate.artifact.summary,
        highlights: candidate.artifact.highlights,
      }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const byContentDate = toTimestamp(b.entry.contentDateISO ?? b.artifact.contentDateISO) - toTimestamp(a.entry.contentDateISO ?? a.artifact.contentDateISO);
      if (byContentDate !== 0) {
        return byContentDate;
      }
      return toTimestamp(b.entry.updatedAtISO) - toTimestamp(a.entry.updatedAtISO);
    });

  const meaningfulQuery = queryTokens.length > 0;
  const hasMatches = ranked.some((item) => item.score > 0);
  logInfo(ctx, 'timeline_chat_retrieval', {
    candidateCount: filtered.length,
    selectedCount: Math.min(body.limit, ranked.length),
    queryTokensCount: queryTokens.length,
  });

  if (!hasMatches) {
    return respond(
      noMatchResponse(
        meaningfulQuery
          ? 'No timeline artifacts matched that query. Try different keywords, broader filters, or summarize more sources first.'
          : 'No meaningful query terms found. Add specific keywords (names, topics, or dates) to search your artifacts.',
      ),
    );
  }

  const topRanked = ranked.slice(0, body.limit);
  const payloadArtifacts: Array<{
    artifactId: string;
    title: string;
    contentDateISO?: string;
    summary: string;
    highlights: string[];
    evidence?: Array<{ sourceId?: string; excerpt: string }>;
  }> = [];
  let runningTotalChars = 0;
  let truncatedFields = 0;

  for (const candidate of topRanked) {
    const trimmedSummary = trimTo(candidate.artifact.summary, MAX_SUMMARY_CHARS) ?? '';
    if (trimmedSummary.length < candidate.artifact.summary.length) {
      truncatedFields += 1;
    }

    const baseArtifact = {
      artifactId: candidate.artifact.artifactId,
      title: candidate.artifact.title,
      contentDateISO: candidate.artifact.contentDateISO,
      summary: trimmedSummary,
      highlights: candidate.artifact.highlights,
    };

    const evidence = (candidate.artifact.evidence ?? [])
      .map((item) => ({
        ...(item.sourceId ? { sourceId: item.sourceId } : {}),
        excerpt: trimTo(item.excerpt, MAX_EXCERPT_CHARS) ?? '',
      }))
      .filter((item) => item.excerpt);

    if ((candidate.artifact.evidence ?? []).length !== evidence.length) {
      truncatedFields += 1;
    }
    if (evidence.some((item, idx) => item.excerpt.length < (candidate.artifact.evidence?.[idx]?.excerpt.length ?? 0))) {
      truncatedFields += 1;
    }

    const nextArtifact = {
      ...baseArtifact,
      ...(evidence.length ? { evidence } : {}),
    };
    const nextArtifactChars = estimateArtifactChars(nextArtifact);

    if (runningTotalChars + nextArtifactChars > MAX_TOTAL_CHARS && payloadArtifacts.length > 0) {
      break;
    }

    payloadArtifacts.push(nextArtifact);
    runningTotalChars += nextArtifactChars;

    if (runningTotalChars >= MAX_TOTAL_CHARS) {
      break;
    }
  }

  if (payloadArtifacts.length === 0 && topRanked.length > 0) {
    const first = topRanked[0].artifact;
    payloadArtifacts.push({
      artifactId: first.artifactId,
      title: first.title,
      contentDateISO: first.contentDateISO,
      summary: trimTo(first.summary, Math.min(MAX_SUMMARY_CHARS, 500)) ?? '',
      highlights: first.highlights.slice(0, 2),
    });
    runningTotalChars = estimateArtifactChars(payloadArtifacts[0]);
    truncatedFields += 1;
  }

  const usedArtifactIds = payloadArtifacts.map((artifact) => artifact.artifactId);

  logInfo(ctx, 'timeline_chat_budget', {
    totalChars: runningTotalChars,
    truncatedFields,
    finalArtifactCount: payloadArtifacts.length,
  });

  try {
    const { provider, settings } = await getTimelineProviderFromDrive(drive, driveFolderId, ctx);
    const providerOutput = await provider.timelineChat(
      {
        query: body.query,
        artifacts: payloadArtifacts,
      },
      settings,
    );

    const normalizedCitations = normalizeTimelineCitations(providerOutput.citations, {
      allowedArtifactIds: usedArtifactIds,
      maxCitations: 10,
      maxExcerptChars: MAX_EXCERPT,
    });

    if (providerOutput.citations.length > 0 && normalizedCitations.length === 0) {
      logWarn(ctx, 'timeline_chat_citations_filtered_out', {
        providerCitationCount: providerOutput.citations.length,
        usedArtifactCount: usedArtifactIds.length,
      });
    }

    const citations = normalizedCitations.map((citation) => ({
      artifactId: citation.artifactId,
      excerpt: citation.excerpt,
      ...(artifactMap.get(citation.artifactId)?.contentDateISO
        ? { contentDateISO: artifactMap.get(citation.artifactId)?.contentDateISO }
        : {}),
      ...(artifactMap.get(citation.artifactId)?.title
        ? { title: artifactMap.get(citation.artifactId)?.title }
        : {}),
    }));

    const responsePayload = ResponseSchema.parse({
      answer: providerOutput.answer,
      citations,
      usedArtifactIds,
    });

    return respond(NextResponse.json(responsePayload));
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'bad_output') {
      return respond(jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'));
    }
    throw error;
  }
};
