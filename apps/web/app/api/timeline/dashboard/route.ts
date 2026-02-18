import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SynthesisArtifactSchema, SummaryArtifactSchema, type SuggestedAction } from '@timeline/shared';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { hashUserHint, logInfo } from '../../../lib/logger';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';

const MAX_SYNTHESIS_ITEMS = 20;
const MAX_ACTION_PROPOSED = 50;
const MAX_ACTION_RESOLVED = 20;
const MAX_ARTIFACT_FETCHES = 60;

const DashboardResponseSchema = z
  .object({
    ok: z.literal(true),
    summary: z.object({ totalArtifacts: z.number(), totalSyntheses: z.number(), proposedActions: z.number() }).strict(),
    syntheses: z
      .array(
        z
          .object({
            artifactId: z.string(),
            title: z.string(),
            mode: z.enum(['briefing', 'status_report', 'decision_log', 'open_loops']).optional(),
            createdAtISO: z.string().optional(),
            contentDateISO: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
    actionQueue: z
      .array(
        z
          .object({
            artifactId: z.string(),
            artifactTitle: z.string().optional(),
            artifactKind: z.enum(['summary', 'synthesis']).optional(),
            contentDateISO: z.string().optional(),
            action: z
              .object({
                id: z.string(),
                type: z.enum(['reminder', 'task', 'calendar']),
                text: z.string(),
                dueDateISO: z.string().nullable().optional(),
                confidence: z.number().nullable().optional(),
                status: z.enum(['proposed', 'accepted', 'dismissed']),
                updatedAtISO: z.string().optional(),
                calendarEvent: z
                  .object({
                    id: z.string(),
                    htmlLink: z.string(),
                  })
                  .nullable()
                  .optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
};

const toTs = (value?: string) => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
};

const normalizeAction = (action: SuggestedAction) => ({
  id: action.id ?? '',
  type: action.type,
  text: action.text,
  ...(typeof action.dueDateISO !== 'undefined' ? { dueDateISO: action.dueDateISO } : {}),
  ...(typeof action.confidence !== 'undefined' ? { confidence: action.confidence } : {}),
  status: action.status ?? 'proposed',
  ...(action.updatedAtISO ? { updatedAtISO: action.updatedAtISO } : {}),
  ...(typeof action.calendarEvent !== 'undefined'
    ? {
        calendarEvent: action.calendarEvent
          ? {
              id: action.calendarEvent.id,
              htmlLink: action.calendarEvent.htmlLink,
            }
          : null,
      }
    : {}),
});

export const GET = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/dashboard');
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
  const rateStatus = checkRateLimit(rateKey, { limit: 60, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.'));
  }

  const drive = createDriveClient(accessToken);
  const loadedIndex = await loadArtifactIndex(drive, driveFolderId, ctx);
  const sorted = [...loadedIndex.index.artifacts].sort((a, b) => {
    const byContent = toTs(b.contentDateISO) - toTs(a.contentDateISO);
    if (byContent !== 0) return byContent;
    return toTs(b.updatedAtISO) - toTs(a.updatedAtISO);
  });

  const syntheses: Array<{ artifactId: string; title: string; mode?: 'briefing' | 'status_report' | 'decision_log' | 'open_loops'; createdAtISO?: string; contentDateISO?: string }> = sorted
    .filter((entry) => entry.kind === 'synthesis')
    .slice(0, MAX_SYNTHESIS_ITEMS)
    .map((entry) => ({
      artifactId: entry.id,
      title: entry.title ?? entry.id,
      ...(entry.contentDateISO ? { contentDateISO: entry.contentDateISO } : {}),
    }));

  const actionProposed: z.infer<typeof DashboardResponseSchema>['actionQueue'] = [];
  const actionResolved: z.infer<typeof DashboardResponseSchema>['actionQueue'] = [];
  let fetchCount = 0;

  for (const entry of sorted) {
    if (fetchCount >= MAX_ARTIFACT_FETCHES) break;
    if (actionProposed.length >= MAX_ACTION_PROPOSED && actionResolved.length >= MAX_ACTION_RESOLVED) break;

    try {
      fetchCount += 1;
      const response = await drive.files.get({ fileId: entry.driveFileId, alt: 'media' }, { responseType: 'json' });
      const parsedJson = parseDriveJson(response.data);
      const synthesis = SynthesisArtifactSchema.safeParse(parsedJson);
      const summary = synthesis.success ? null : SummaryArtifactSchema.safeParse(parsedJson);
      if (!synthesis.success && !(summary && summary.success)) {
        continue;
      }

      const artifactKind: 'summary' | 'synthesis' = synthesis.success ? 'synthesis' : 'summary';
      let actions: SuggestedAction[] = [];
      if (synthesis.success) {
        actions = (synthesis.data.suggestedActions ?? []).filter((action) => action.id);
      } else if (summary?.success) {
        actions = (summary.data.suggestedActions ?? []).filter((action) => action.id);
      }
      if (!actions.length) continue;

      if (synthesis.success) {
        const match = syntheses.find((item) => item.artifactId === entry.id);
        if (match && !match.mode) {
          match.mode = synthesis.data.mode;
          match.createdAtISO = synthesis.data.createdAtISO;
        }
      }

      for (const action of actions) {
        const normalizedStatus = action.status ?? 'proposed';
        const queueItem = {
          artifactId: entry.driveFileId,
          ...(entry.title ? { artifactTitle: entry.title } : {}),
          artifactKind,
          ...(entry.contentDateISO ? { contentDateISO: entry.contentDateISO } : {}),
          action: { ...normalizeAction(action), status: normalizedStatus },
        };

        if (normalizedStatus === 'proposed') {
          if (actionProposed.length < MAX_ACTION_PROPOSED) actionProposed.push(queueItem);
        } else if (actionResolved.length < MAX_ACTION_RESOLVED) {
          actionResolved.push(queueItem);
        }
      }
    } catch {
      // best effort reads only
    }
  }

  const responsePayload = DashboardResponseSchema.parse({
    ok: true,
    summary: {
      totalArtifacts: loadedIndex.index.artifacts.length,
      totalSyntheses: loadedIndex.index.artifacts.filter((entry) => entry.kind === 'synthesis').length,
      proposedActions: actionProposed.length,
    },
    syntheses,
    actionQueue: [...actionProposed, ...actionResolved],
  });

  return respond(NextResponse.json(responsePayload));
};
