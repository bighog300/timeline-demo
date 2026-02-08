import { NextResponse } from 'next/server';

import { isAdminSession } from '../../lib/adminAuth';
import { readAdminSettingsFromDrive } from '../../lib/adminSettingsDrive';
import { buildContextPack, buildContextString } from '../../lib/chatContext';
import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createDriveClient } from '../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../lib/googleRequest';
import { NotConfiguredError } from '../../lib/llm/errors';
import { callLLM } from '../../lib/llm/index';
import type { LLMProviderName } from '../../lib/llm/types';
import { hashUserHint, logError, logInfo, logWarn, safeError } from '../../lib/logger';
import { createCtx, withRequestId } from '../../lib/requestContext';

type ChatCitation = {
  artifactId: string;
  title: string;
  dateISO?: string;
  kind: 'summary' | 'index' | 'selection_set';
};

type ChatResponse = {
  reply: string;
  citations: ChatCitation[];
  suggested_actions: string[];
  provider: { name: LLMProviderName; model: string };
  requestId: string;
};

type ChatErrorResponse = {
  error: { code: string; message?: string; details?: unknown };
  error_code?: string;
  requestId: string;
};

const APP_RULES = [
  'Only use the provided context; do not invent document content.',
  'If the answer is not in the summaries, say so and suggest summarizing or syncing.',
  'Respect user data policy: artifacts live in Drive and there is no background scanning.',
  'Cite sources as [1], [2] using the provided SOURCE numbers.',
].join('\n');

const buildSystemPrompt = (systemPrompt: string) =>
  [systemPrompt?.trim(), APP_RULES].filter(Boolean).join('\n\n');

const uniqueActions = (actions: string[]) => Array.from(new Set(actions));

const extractKeyword = (message: string) => {
  const normalized = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
  if (!normalized) {
    return null;
  }
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 2);
  return tokens[0] ?? null;
};

const buildSuggestedActions = (message: string) => {
  const normalized = message.toLowerCase();
  const actions = ['Show pending summaries', 'Sync from Drive', 'Open Calendar'];

  if (/summary|summaries|timeline/.test(normalized)) {
    actions.push('Show pending summaries');
  }

  if (/sync|refresh|drive/.test(normalized)) {
    actions.push('Sync from Drive');
  }

  const keyword = extractKeyword(message);
  if (keyword) {
    actions.push(`Search timeline for “${keyword}”`);
  }

  return uniqueActions(actions);
};

const jsonChatError = (status: number, payload: ChatErrorResponse) =>
  NextResponse.json(payload, { status });

export async function POST(request: Request) {
  const ctx = createCtx(request, '/api/chat');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', { method: request.method });

  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(
      jsonChatError(401, {
        error: { code: 'reconnect_required', message: 'Reconnect required.' },
        error_code: 'reconnect_required',
        requestId: ctx.requestId,
      }),
    );
  }

  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return respond(
      jsonChatError(401, {
        error: { code: 'reconnect_required', message: 'Reconnect required.' },
        error_code: 'reconnect_required',
        requestId: ctx.requestId,
      }),
    );
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const drive = createDriveClient(accessToken);
  let adminSettings = null;

  try {
    const result = await readAdminSettingsFromDrive(drive, driveFolderId, ctx);
    adminSettings = result.settings;
  } catch (error) {
    logGoogleError(error, 'drive.files.get', ctx);
    const mapped = mapGoogleError(error, 'drive.files.get');
    logError(ctx, 'admin_settings_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(
      jsonChatError(mapped.status, {
        error: { code: mapped.code, message: mapped.message, details: mapped.details },
        error_code: mapped.code,
        requestId: ctx.requestId,
      }),
    );
  }

  const maxContextItems = adminSettings?.maxContextItems;
  let contextPack;
  try {
    contextPack = await buildContextPack({
      queryText: message,
      drive,
      driveFolderId,
      maxItems: maxContextItems,
      ctx,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.get', ctx);
    const mapped = mapGoogleError(error, 'drive.files.get');
    logError(ctx, 'context_pack_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(
      jsonChatError(mapped.status, {
        error: { code: mapped.code, message: mapped.message, details: mapped.details },
        error_code: mapped.code,
        requestId: ctx.requestId,
      }),
    );
  }

  const { context, items } = buildContextString(contextPack.items);
  const systemPrompt = buildSystemPrompt(adminSettings?.systemPrompt ?? '');
  const provider = adminSettings?.provider ?? 'stub';
  const model = adminSettings?.model ?? 'stub';

  const messages = [
    ...(context
      ? [
          {
            role: 'user' as const,
            content: `Context:\n${context}`,
          },
        ]
      : []),
    { role: 'user' as const, content: message || 'Summarize recent timeline context.' },
  ];

  const llmRequest = {
    model,
    systemPrompt,
    messages,
    temperature: adminSettings?.temperature,
  };

  let llmProvider: LLMProviderName = provider;
  let llmResponseText = '';

  try {
    const response = await callLLM(provider, llmRequest);
    llmResponseText = response.text;
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      const isAdmin = isAdminSession(session);
      if (isAdmin) {
        return respond(
          jsonChatError(400, {
            error: {
              code: 'not_configured',
              message: 'The selected provider is not configured. Set the API key on the server.',
            },
            error_code: 'not_configured',
            requestId: ctx.requestId,
          }),
        );
      }

      llmProvider = 'stub';
      logWarn(ctx, 'provider_not_configured', { provider });
      const response = await callLLM('stub', {
        ...llmRequest,
        model: 'stub',
      });
      llmResponseText = response.text;
    } else {
      logError(ctx, 'llm_error', { error: safeError(error) });
      return respond(
        jsonChatError(500, {
          error: { code: 'upstream_error', message: 'Chat provider failed to respond.' },
          error_code: 'upstream_error',
          requestId: ctx.requestId,
        }),
      );
    }
  }

  const citations: ChatCitation[] = items.map((item) => ({
    artifactId: item.artifactId,
    title: item.title,
    dateISO: item.dateISO,
    kind: item.kind,
  }));

  const reply =
    llmResponseText ||
    'I could not find enough detail in your saved summaries. Try syncing or summarizing more items.';

  const responsePayload: ChatResponse = {
    reply,
    citations,
    suggested_actions: buildSuggestedActions(message),
    provider: { name: llmProvider, model: llmProvider === 'stub' ? 'stub' : model },
    requestId: ctx.requestId,
  };

  return respond(NextResponse.json(responsePayload));
}
