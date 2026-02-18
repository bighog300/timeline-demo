import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  SynthesisArtifactSchema,
  SynthesisRequestSchema,
  SynthesisResponseSchema,
  SummaryArtifactSchema,
  type ArtifactIndexEntry,
  type SuggestedAction,
} from '@timeline/shared';

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
import { canonicalizeEntities, readEntityAliasesFromDrive } from '../../../lib/entities/aliases';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { hashUserHint, logError, logInfo, safeError } from '../../../lib/logger';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import {
  loadArtifactIndex,
  saveArtifactIndex,
  upsertArtifactIndexEntry,
} from '../../../lib/timeline/artifactIndex';

const MAX_TOTAL_CHARS = 24000;
const MAX_SUMMARY_CHARS = 1600;
const MAX_HIGHLIGHT_CHARS = 200;
const MAX_EVIDENCE_CHARS = 220;

const toTs = (value?: string) => {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
};

const trimTo = (value: string | undefined, maxChars: number) => {
  if (!value) return undefined;
  return value.length <= maxChars ? value : value.slice(0, maxChars);
};

const isWithinDateRange = (value: string | undefined, from?: string, to?: string) => {
  if (!value) return true;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return true;
  if (from && ts < new Date(from).getTime()) return false;
  if (to && ts > new Date(to).getTime()) return false;
  return true;
};

const estimateChars = (artifact: {
  title: string;
  summary: string;
  highlights: string[];
  evidence?: Array<{ excerpt: string }>;
}) =>
  artifact.title.length +
  artifact.summary.length +
  artifact.highlights.reduce((acc, item) => acc + item.length, 0) +
  (artifact.evidence ?? []).reduce((acc, item) => acc + item.excerpt.length, 0);


const normalizeSynthesisActions = (actions: SuggestedAction[] | undefined, nowISO: string): SuggestedAction[] | undefined => {
  if (!actions?.length) {
    return undefined;
  }

  return actions.map((action) => {
    const hashedId = createHash('sha1')
      .update(`${action.type}|${action.text.trim().toLowerCase()}|${action.dueDateISO ?? ''}`)
      .digest('hex')
      .slice(0, 12);

    return {
      ...action,
      id: action.id?.trim() || `act_${hashedId}`,
      status: action.status ?? 'proposed',
      createdAtISO: action.createdAtISO ?? nowISO,
      updatedAtISO: nowISO,
    };
  });
};

const modeTitle = (mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops') => {
  switch (mode) {
    case 'status_report':
      return 'Status report synthesis';
    case 'decision_log':
      return 'Decision log synthesis';
    case 'open_loops':
      return 'Open loops synthesis';
    default:
      return 'Cross-artifact briefing';
  }
};

const buildNoMatch = (mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops') =>
  SynthesisResponseSchema.parse({
    ok: true,
    synthesis: {
      synthesisId: `empty_${Date.now()}`,
      mode,
      title: modeTitle(mode),
      createdAtISO: new Date().toISOString(),
      content:
        'No matching artifacts were found. Try broadening your date range or filters, or summarize more sources first.',
    },
    citations: [],
    usedArtifactIds: [],
  });

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/synthesize');
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
  const rateStatus = checkRateLimit(rateKey, { limit: 20, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  let body: ReturnType<typeof SynthesisRequestSchema.parse>;
  try {
    const parsed = SynthesisRequestSchema.safeParse(await request.json());
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

  let aliasConfig = { version: 1 as const, updatedAtISO: new Date().toISOString(), aliases: [] as never[] };
  try {
    aliasConfig = (await readEntityAliasesFromDrive(drive, driveFolderId, ctx)).aliases as typeof aliasConfig;
  } catch {
    // alias loading is best-effort
  }

  const loadedIndex = await loadArtifactIndex(drive, driveFolderId, ctx);
  const indexEntries = loadedIndex.index.artifacts.filter((entry) => entry.kind !== 'synthesis');
  let selectedEntries: ArtifactIndexEntry[];

  if (body.artifactIds?.length) {
    const byId = new Map(indexEntries.map((entry) => [entry.id, entry]));
    const unknown = body.artifactIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return respond(
        jsonError(400, 'invalid_request', 'One or more artifactIds are unknown.', {
          unknownArtifactIds: unknown,
        }),
      );
    }
    selectedEntries = body.artifactIds.map((id) => byId.get(id) as ArtifactIndexEntry);
  } else {
    selectedEntries = indexEntries
      .filter((entry) => isWithinDateRange(entry.contentDateISO, body.dateFromISO, body.dateToISO))
      .filter((entry) => {
        if (!body.tags?.length) return true;
        const tags = new Set((entry.tags ?? []).map((tag) => tag.toLowerCase()));
        return body.tags.some((tag) => tags.has(tag.toLowerCase()));
      })
      .filter((entry) => {
        if (!body.participants?.length) return true;
        const participants = new Set((entry.participants ?? []).map((p) => p.toLowerCase()));
        return body.participants.some((p) => participants.has(p.toLowerCase()));
      })
      .sort((a, b) => {
        const byContentDate = toTs(b.contentDateISO) - toTs(a.contentDateISO);
        if (byContentDate !== 0) return byContentDate;
        return toTs(b.updatedAtISO) - toTs(a.updatedAtISO);
      })
      .slice(0, body.limit);
  }

  if (selectedEntries.length === 0) {
    return respond(NextResponse.json(buildNoMatch(body.mode)));
  }

  const loadedArtifacts: Array<{ entry: ArtifactIndexEntry; artifact: ReturnType<typeof SummaryArtifactSchema.parse> }> = [];
  for (const entry of selectedEntries) {
    try {
      const response = await drive.files.get({ fileId: entry.driveFileId, alt: 'media' }, { responseType: 'json' });
      const parsed = SummaryArtifactSchema.safeParse(
        typeof response.data === 'string' ? JSON.parse(response.data) : response.data,
      );
      if (parsed.success) {
        loadedArtifacts.push({ entry, artifact: parsed.data });
      }
    } catch (error) {
      logError(ctx, 'synthesis_artifact_read_failed', { artifactId: entry.id, error: safeError(error) });
    }
  }

  if (loadedArtifacts.length === 0) {
    return respond(NextResponse.json(buildNoMatch(body.mode)));
  }

  const payloadArtifacts: Array<{
    artifactId: string;
    title: string;
    contentDateISO?: string;
    summary: string;
    highlights: string[];
    evidence?: Array<{ sourceId?: string; excerpt: string }>;
  }> = [];
  let totalChars = 0;

  for (const { artifact } of loadedArtifacts.slice(0, body.limit)) {
    const next = {
      artifactId: artifact.artifactId,
      title: trimTo(artifact.title, 160) ?? artifact.title,
      contentDateISO: artifact.contentDateISO,
      summary: trimTo(artifact.summary, MAX_SUMMARY_CHARS) ?? '',
      highlights: artifact.highlights.map((item) => trimTo(item, MAX_HIGHLIGHT_CHARS) ?? '').filter(Boolean),
      ...(body.includeEvidence
        ? {
            evidence: (artifact.evidence ?? [])
              .slice(0, 5)
              .map((item) => ({
                ...(item.sourceId ? { sourceId: item.sourceId } : {}),
                excerpt: trimTo(item.excerpt, MAX_EVIDENCE_CHARS) ?? '',
              }))
              .filter((item) => item.excerpt),
          }
        : {}),
    };

    const nextChars = estimateChars(next);
    if (totalChars + nextChars > MAX_TOTAL_CHARS && payloadArtifacts.length > 0) break;

    payloadArtifacts.push(next);
    totalChars += nextChars;
    if (totalChars >= MAX_TOTAL_CHARS) break;
  }

  if (payloadArtifacts.length === 0) {
    const first = loadedArtifacts[0]?.artifact;
    if (first) {
      payloadArtifacts.push({
        artifactId: first.artifactId,
        title: first.title,
        contentDateISO: first.contentDateISO,
        summary: trimTo(first.summary, 500) ?? '',
        highlights: first.highlights.slice(0, 2),
      });
    }
  }

  const usedArtifactIds = payloadArtifacts.map((item) => item.artifactId);

  try {
    const { provider, settings } = await getTimelineProviderFromDrive(drive, driveFolderId, ctx);

    const providerOutput = await provider.timelineSynthesize(
      {
        mode: body.mode,
        title: body.title,
        includeEvidence: body.includeEvidence,
        artifacts: payloadArtifacts,
      },
      settings,
    );

    const nowISO = new Date().toISOString();
    const normalizedSuggestedActions = normalizeSynthesisActions(providerOutput.synthesis.suggestedActions, nowISO);
    const canonicalEntities = canonicalizeEntities(providerOutput.synthesis.entities, aliasConfig);

    const citationEntries = new Map(loadedArtifacts.map(({ entry, artifact }) => [
      artifact.artifactId,
      { title: entry.title ?? artifact.title, contentDateISO: entry.contentDateISO ?? artifact.contentDateISO },
    ]));

    const citations = normalizeTimelineCitations(providerOutput.citations, {
      allowedArtifactIds: usedArtifactIds,
      maxCitations: 15,
      maxExcerptChars: 300,
    }).map((citation) => ({
      artifactId: citation.artifactId,
      excerpt: citation.excerpt,
      ...(citationEntries.get(citation.artifactId)?.contentDateISO
        ? { contentDateISO: citationEntries.get(citation.artifactId)?.contentDateISO }
        : {}),
      ...(citationEntries.get(citation.artifactId)?.title
        ? { title: citationEntries.get(citation.artifactId)?.title }
        : {}),
    }));

    let savedArtifactId: string | undefined;

    if (body.saveToTimeline) {
      const createdAtISO = nowISO;
      const synthesisId =
        providerOutput.synthesis.synthesisId ||
        `syn_${createHash('sha1').update(`${createdAtISO}:${usedArtifactIds.join('|')}:${body.mode}`).digest('hex').slice(0, 12)}`;
      const synthesisArtifact = SynthesisArtifactSchema.parse({
        kind: 'synthesis',
        id: synthesisId,
        title: providerOutput.synthesis.title,
        mode: body.mode,
        createdAtISO,
        contentDateISO: createdAtISO,
        sourceArtifactIds: usedArtifactIds,
        content: providerOutput.synthesis.content,
        citations: citations.map((citation) => ({ artifactId: citation.artifactId, excerpt: citation.excerpt })),
        summary: providerOutput.synthesis.content.slice(0, 220),
        tags: providerOutput.synthesis.tags ?? body.tags,
        topics: providerOutput.synthesis.topics,
        participants: providerOutput.synthesis.participants ?? body.participants,
        entities: canonicalEntities,
        decisions: providerOutput.synthesis.decisions,
        openLoops: providerOutput.synthesis.openLoops,
        risks: providerOutput.synthesis.risks,
        ...(normalizedSuggestedActions?.length ? { suggestedActions: normalizedSuggestedActions } : {}),
      });

      const fileName = `synthesis_${createdAtISO.slice(0, 10).replace(/-/g, '')}_${body.mode}_${synthesisId}.json`;
      const createResp = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [driveFolderId],
          mimeType: 'application/json',
        },
        media: {
          mimeType: 'application/json',
          body: JSON.stringify(synthesisArtifact, null, 2),
        },
        fields: 'id',
      });

      savedArtifactId = synthesisId;
      const driveFileId = createResp.data.id ?? '';
      if (driveFileId) {
        const nextIndex = upsertArtifactIndexEntry(loadedIndex.index, {
          id: synthesisId,
          driveFileId,
          kind: 'synthesis',
          title: providerOutput.synthesis.title,
          contentDateISO: createdAtISO,
          tags: providerOutput.synthesis.tags ?? body.tags,
          topics: providerOutput.synthesis.topics,
          participants: providerOutput.synthesis.participants ?? body.participants,
          entities: canonicalEntities.slice(0, 10),
          decisionsCount: providerOutput.synthesis.decisions?.length ?? 0,
          openLoopsCount: (providerOutput.synthesis.openLoops ?? []).filter((loop) => (loop.status ?? 'open') === 'open').length,
          risksCount: providerOutput.synthesis.risks?.length ?? 0,
          updatedAtISO: createdAtISO,
        });
        await saveArtifactIndex(drive, driveFolderId, loadedIndex.fileId, nextIndex, ctx);
      }
    }

    const responsePayload = SynthesisResponseSchema.parse({
      ok: true,
      synthesis: {
        ...providerOutput.synthesis,
        ...(canonicalEntities.length ? { entities: canonicalEntities } : {}),
        mode: body.mode,
        title: providerOutput.synthesis.title || body.title || modeTitle(body.mode),
        ...(normalizedSuggestedActions?.length ? { suggestedActions: normalizedSuggestedActions } : {}),
      },
      citations,
      usedArtifactIds,
      ...(savedArtifactId ? { savedArtifactId } : {}),
    });

    logInfo(ctx, 'timeline_synthesis_complete', {
      selectedCount: selectedEntries.length,
      usedCount: usedArtifactIds.length,
      chars: totalChars,
      elapsedMs: Date.now() - startedAt,
    });

    return respond(NextResponse.json(responsePayload));
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'bad_output') {
      return respond(jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'));
    }
    throw error;
  }
};
