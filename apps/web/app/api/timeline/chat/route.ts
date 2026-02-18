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
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { hashUserHint, logError, logInfo, safeError } from '../../../lib/logger';
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

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);

const scoreArtifact = (query: string, fields: string[]) => {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  const haystack = tokenize(fields.join(' '));
  const hayset = new Set(haystack);
  return q.reduce((acc, token) => acc + (hayset.has(token) ? 1 : 0), 0);
};

const isWithinDateRange = (value: string | undefined, from?: string, to?: string) => {
  if (!value) return true;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return true;
  if (from && ts < new Date(from).getTime()) return false;
  if (to && ts > new Date(to).getTime()) return false;
  return true;
};

const MAX_EXCERPT = 300;

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
      NextResponse.json(
        ResponseSchema.parse({
          answer:
            'No matching timeline artifacts were found. Try broadening filters, summarizing more sources, or asking a different question.',
          citations: [],
          usedArtifactIds: [],
        }),
      ),
    );
  }

  const scored = filtered
    .map((artifact) => ({
      artifact,
      score: scoreArtifact(body.query, [artifact.title ?? '', ...(artifact.tags ?? []), ...(artifact.participants ?? [])]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, body.limit);

  const artifactMap = new Map(index.artifacts.map((entry) => [entry.id, entry]));
  const loadedArtifacts = [] as z.infer<typeof SummaryArtifactSchema>[];

  for (const item of scored) {
    try {
      const response = await drive.files.get(
        { fileId: item.artifact.driveFileId, alt: 'media' },
        { responseType: 'json' },
      );
      const parsed = SummaryArtifactSchema.safeParse(typeof response.data === 'string' ? JSON.parse(response.data) : response.data);
      if (parsed.success) {
        loadedArtifacts.push(parsed.data);
      }
    } catch (error) {
      logError(ctx, 'artifact_read_failed', { error: safeError(error) });
    }
  }

  if (loadedArtifacts.length === 0) {
    return respond(
      NextResponse.json(
        ResponseSchema.parse({
          answer: 'No matching timeline artifacts were readable. Please retry after syncing.',
          citations: [],
          usedArtifactIds: [],
        }),
      ),
    );
  }

  try {
    const { provider, settings } = await getTimelineProviderFromDrive(drive, driveFolderId, ctx);
    const providerOutput = await provider.timelineChat(
      {
        query: body.query,
        artifacts: loadedArtifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          title: artifact.title,
          contentDateISO: artifact.contentDateISO,
          summary: artifact.summary,
          highlights: artifact.highlights,
        })),
      },
      settings,
    );

    const citations = providerOutput.citations.slice(0, 10).map((citation) => ({
      artifactId: citation.artifactId,
      excerpt: citation.excerpt.slice(0, MAX_EXCERPT),
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
      usedArtifactIds: providerOutput.usedArtifactIds?.length
        ? providerOutput.usedArtifactIds.slice(0, body.limit)
        : Array.from(new Set(citations.map((citation) => citation.artifactId))),
    });

    return respond(NextResponse.json(responsePayload));
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'bad_output') {
      return respond(jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'));
    }
    throw error;
  }
};
