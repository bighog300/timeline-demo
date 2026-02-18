import { NextResponse, type NextRequest } from 'next/server';
import { DriveSummaryJsonSchema, SynthesisArtifactSchema } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import { createCalendarEvent, GoogleCalendarApiError } from '../../../lib/googleCalendar';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../lib/googleRequest';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { hashUserHint, logInfo } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { loadArtifactIndex, saveArtifactIndex, upsertArtifactIndexEntry } from '../../../lib/timeline/artifactIndex';

const DecisionRequestSchema = z
  .object({
    artifactId: z.string().min(1),
    actionId: z.string().min(1),
    decision: z.enum(['accept', 'dismiss']),
  })
  .strict();

const ACTIONS_LOG_FILE = 'actions_log.jsonl';

const CalendarEventSchema = z
  .object({
    id: z.string().min(1),
    htmlLink: z.string().url(),
    startISO: z.string().min(1),
    endISO: z.string().min(1),
    createdAtISO: z.string().min(1),
  })
  .strict();

const ActionDecisionResponseSchema = z
  .object({
    ok: z.literal(true),
    artifactId: z.string().min(1),
    actionId: z.string().min(1),
    status: z.enum(['accepted', 'dismissed']),
    calendarEvent: CalendarEventSchema.optional(),
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


const parseArtifactForActions = (value: unknown):
  | { kind: 'summary'; artifact: ReturnType<typeof DriveSummaryJsonSchema.parse> }
  | { kind: 'synthesis'; artifact: ReturnType<typeof SynthesisArtifactSchema.parse> }
  | null => {
  const synthesis = SynthesisArtifactSchema.safeParse(value);
  if (synthesis.success) {
    return { kind: 'synthesis', artifact: synthesis.data };
  }

  const summary = DriveSummaryJsonSchema.safeParse(value);
  if (summary.success) {
    return { kind: 'summary', artifact: summary.data };
  }

  return null;
};

const appendActionLogBestEffort = async (
  drive: ReturnType<typeof createDriveClient>,
  folderId: string,
  line: Record<string, unknown>,
) => {
  if (process.env.ACTIONS_LOG_ENABLED !== 'true') {
    return;
  }

  try {
    const listed = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.list(
            {
              q: `'${folderId}' in parents and trashed=false and name='${ACTIONS_LOG_FILE}'`,
              pageSize: 1,
              fields: 'files(id)',
            },
            { signal: timeoutSignal },
          ),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
    const fileId = listed.data.files?.[0]?.id;
    const existing = fileId
      ? await withRetry((signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.get({ fileId, alt: 'media' }, { responseType: 'text', signal: timeoutSignal }),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        )
      : null;

    const oldBody = typeof existing?.data === 'string' ? existing.data : '';
    const nextBody = `${oldBody}${oldBody.endsWith('\n') || oldBody.length === 0 ? '' : '\n'}${JSON.stringify(line)}\n`;

    if (fileId) {
      await withRetry((signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.update(
              {
                fileId,
                media: {
                  mimeType: 'application/x-ndjson',
                  body: nextBody,
                },
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      );
      return;
    }

    await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.create(
            {
              requestBody: {
                name: ACTIONS_LOG_FILE,
                parents: [folderId],
                mimeType: 'application/x-ndjson',
              },
              media: {
                mimeType: 'application/x-ndjson',
                body: nextBody,
              },
            },
            { signal: timeoutSignal },
          ),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
  } catch {
    // best-effort logging only
  }
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/actions');
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
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  let body: z.infer<typeof DecisionRequestSchema>;
  try {
    body = DecisionRequestSchema.parse(await request.json());
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);

  let fileResponse;
  try {
    fileResponse = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.get({ fileId: body.artifactId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.get', ctx);
    const mapped = mapGoogleError(error, 'drive.files.get');
    if (mapped.status === 404) {
      return respond(jsonError(404, 'not_found', 'Artifact not found.'));
    }
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  const parsedArtifact = parseArtifactForActions(parseDriveJson(fileResponse.data));
  if (!parsedArtifact) {
    return respond(jsonError(400, 'invalid_request', 'Artifact data was invalid.'));
  }

  const artifact = parsedArtifact.artifact;
  const status = body.decision === 'accept' ? 'accepted' : 'dismissed';
  const nowISO = new Date().toISOString();
  const existingActions = artifact.suggestedActions ?? [];
  const targetAction = existingActions.find((action) => action.id === body.actionId);

  if (!targetAction) {
    return respond(jsonError(404, 'not_found', 'Action not found.'));
  }

  if (
    body.decision === 'accept' &&
    targetAction.type === 'calendar' &&
    (targetAction.status ?? 'proposed') === 'accepted' &&
    targetAction.calendarEvent
  ) {
    const idempotentResponse = ActionDecisionResponseSchema.parse({
      ok: true,
      artifactId: body.artifactId,
      actionId: body.actionId,
      status: 'accepted',
      calendarEvent: targetAction.calendarEvent,
    });
    return respond(NextResponse.json(idempotentResponse));
  }

  let nextCalendarEvent: z.infer<typeof CalendarEventSchema> | undefined;

  if (body.decision === 'accept' && targetAction.type === 'calendar') {
    if (!targetAction.dueDateISO) {
      return respond(jsonError(400, 'invalid_request', 'Calendar actions require dueDateISO before acceptance.'));
    }

    try {
      const createdEvent = await createCalendarEvent({
        accessToken,
        summary: targetAction.text,
        description: artifact.title,
        startISO: targetAction.dueDateISO,
      });
      nextCalendarEvent = CalendarEventSchema.parse({
        ...createdEvent,
        createdAtISO: nowISO,
      });
    } catch (error) {
      if (error instanceof GoogleCalendarApiError) {
        return respond(
          NextResponse.json(
            {
              error: 'calendar_event_failed',
              message: error.message,
            },
            { status: 502 },
          ),
        );
      }

      return respond(
        NextResponse.json(
          {
            error: 'calendar_event_failed',
            message: 'Unable to create calendar event.',
          },
          { status: 502 },
        ),
      );
    }
  }

  const nextActions = existingActions.map((action) => {
    if (action.id !== body.actionId) {
      return action;
    }

    if (nextCalendarEvent) {
      return {
        ...action,
        status,
        calendarEvent: nextCalendarEvent,
        updatedAtISO: nowISO,
      };
    }

    return {
      ...action,
      status,
      updatedAtISO: nowISO,
    };
  });

  const nextArtifact =
    parsedArtifact.kind === 'summary'
      ? {
          ...artifact,
          suggestedActions: nextActions,
          updatedAtISO: nowISO,
        }
      : {
          ...artifact,
          suggestedActions: nextActions,
        };

  try {
    await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.update(
            {
              fileId: body.artifactId,
              media: { mimeType: 'application/json', body: JSON.stringify(nextArtifact, null, 2) },
            },
            { signal: timeoutSignal },
          ),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.update', ctx);
    const mapped = mapGoogleError(error, 'drive.files.update');
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  try {
    const loaded = await loadArtifactIndex(drive, driveFolderId, ctx);
    const base = loaded.index.artifacts.find((entry) => entry.driveFileId === body.artifactId);
    if (base) {
      const next = upsertArtifactIndexEntry(loaded.index, { ...base, updatedAtISO: nowISO });
      await saveArtifactIndex(drive, driveFolderId, loaded.fileId, next, ctx);
    }
  } catch {
    // index sync is best-effort
  }

  await appendActionLogBestEffort(drive, driveFolderId, {
    tsISO: nowISO,
    userEmail: session.user?.email ?? null,
    artifactId: body.artifactId,
    actionId: body.actionId,
    decision: body.decision,
  });

  const successResponse = ActionDecisionResponseSchema.parse({
    ok: true,
    artifactId: body.artifactId,
    actionId: body.actionId,
    status,
    ...(nextCalendarEvent ? { calendarEvent: nextCalendarEvent } : {}),
  });

  return respond(NextResponse.json(successResponse));
};
