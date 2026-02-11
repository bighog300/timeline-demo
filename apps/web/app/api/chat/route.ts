import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';

import { isAdminSession } from '../../lib/adminAuth';
import { readAdminSettingsFromDrive } from '../../lib/adminSettingsDrive';
import {
  AppDriveFolderResolveError,
  resolveOrProvisionAppDriveFolder,
} from '../../lib/appDriveFolder';
import { buildContextPack, buildContextString } from '../../lib/chatContext';
import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createDriveClient } from '../../lib/googleDrive';
import { createGmailClient } from '../../lib/googleGmail';
import { logGoogleError, mapGoogleError } from '../../lib/googleRequest';
import { NotConfiguredError } from '../../lib/llm/errors';
import { callLLM } from '../../lib/llm/index';
import type { LLMProviderName } from '../../lib/llm/types';
import { hashUserHint, logError, logInfo, logWarn, safeError } from '../../lib/logger';
import {
  fetchOriginalTextForArtifact,
  MAX_ORIGINAL_CHARS_TOTAL,
  type OpenedOriginal,
} from '../../lib/originals';
import { createCtx, withRequestId } from '../../lib/requestContext';

type ChatCitation = {
  artifactId: string;
  title: string;
  dateISO?: string;
  kind: 'summary' | 'index' | 'selection_set' | 'original';
};

type RouterDecision = {
  answer: string;
  needsOriginals: boolean;
  requestedArtifactIds: string[];
  reason: string;
  suggested_actions?: string[];
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

const ADVISOR_PROMPT_ADDENDUM = [
  'Role: timeline advisor reviewing summarized documents and (if allowed) opened originals.',
  'Grounding rules:',
  '- Only state facts supported by provided SOURCES.',
  '- Every factual statement should include citations like [1], [2] in the same paragraph.',
  '- If information is missing or ambiguous, say “Not enough evidence in the provided sources.”',
  'Legal rules:',
  '- Provide general legal considerations and issue-spotting only.',
  '- Use cautious language: “may,” “could,” “might be relevant to…”',
  '- Do not give legal advice; recommend consulting a solicitor for jurisdiction-specific advice.',
  'Psychological rules:',
  '- Do not diagnose or label people with disorders.',
  '- Discuss “signals,” “patterns,” “communication dynamics,” “risk indicators” cautiously.',
  '- If content implies self-harm or immediate danger, recommend contacting emergency services/local crisis resources (generic, non-location-specific).',
  'Output format: MUST use these sections with headings:',
  '',
  '## Timeline summary',
  '- Bullet points of key events in chronological order (include dates if present)',
  '- For each bullet: include citations',
  '',
  '## What stands out',
  '- Themes/patterns across documents (bullets), with citations',
  '',
  '## Legal considerations (general information)',
  '- Issue-spotting bullets (contracts, employment, harassment, confidentiality, defamation, safeguarding, data protection, etc. as relevant)',
  '- Each bullet cites sources and uses cautious language',
  '- Add disclaimer: “Not legal advice.”',
  '',
  '## Psychological and interpersonal signals (non-clinical)',
  '- Bullets describing dynamics (escalation, boundary setting, coercion indicators, manipulation tactics, stress responses, etc.) when supported',
  '- Use cautious language and cite sources',
  '- Add disclaimer: “Not a diagnosis.”',
  '',
  '## Questions to clarify',
  '- Up to 5 questions that, if answered, would reduce uncertainty',
  '- Can reference what additional documents to open/summarize',
  '',
  '## Suggested next steps',
  '- Practical next actions: “Summarize X”, “Open original for SOURCE Y”, “Tag these items”, “Consult a professional”',
  '- Keep it action-oriented and bounded',
].join('\n');

const buildChatSystemPrompt = (systemPrompt: string, advisorMode: boolean) =>
  advisorMode
    ? [buildSystemPrompt(systemPrompt), ADVISOR_PROMPT_ADDENDUM].filter(Boolean).join('\n\n')
    : buildSystemPrompt(systemPrompt);

const formatAdvisorFallbackReply = (sourceCount: number) => {
  const sourceLabel = sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : 'no sources';
  return [
    '## Timeline summary',
    sourceCount > 0
      ? `- I reviewed ${sourceLabel} relevant to your question [1].`
      : '- Not enough evidence in the provided sources.',
    '',
    '## What stands out',
    sourceCount > 0
      ? '- The available summaries may indicate a sequence worth validating with additional details [1].'
      : '- Not enough evidence in the provided sources.',
    '',
    '## Legal considerations (general information)',
    '- Available records may be relevant to contractual, employment, confidentiality, or safeguarding questions depending on context [1].',
    '- Not legal advice.',
    '',
    '## Psychological and interpersonal signals (non-clinical)',
    '- Communication patterns may suggest stress or escalation dynamics, but evidence is limited [1].',
    '- Not a diagnosis.',
    '',
    '## Questions to clarify',
    '- Which event date or interaction should be verified first?',
    '- Are there additional summaries or originals to review for missing context?',
    '',
    '## Suggested next steps',
    '- Summarize additional related documents for the same date range.',
    '- Open originals for the most relevant sources if details are needed.',
    '- Consult a solicitor or other qualified professional for situation-specific guidance.',
  ].join('\n');
};

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

const buildSuggestedActions = (message: string, advisorMode = false) => {
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

  if (advisorMode) {
    actions.unshift(
      'Open originals for SOURCE 1 and SOURCE 2',
      'Summarize emails from key sender between key dates',
      'Create an index for key timeline topic',
      'Tag timeline entries tied to potential legal or interpersonal issues',
      'List unanswered clarification questions',
    );
  }

  return uniqueActions(actions).slice(0, advisorMode ? 5 : 10);
};

const jsonChatError = (status: number, payload: ChatErrorResponse) =>
  NextResponse.json(payload, { status });

const MAX_REQUESTED_ORIGINALS = 3;

const ORIGINALS_ROUTER_PROMPT = [
  'Return valid JSON only with keys: answer, needsOriginals, requestedArtifactIds, reason, suggested_actions.',
  'requestedArtifactIds must include only SOURCE artifact ids from context and at most 3 entries.',
  'Set needsOriginals=true only if details are unavailable from summaries and originals are needed.',
  'Keep answer grounded in summaries and cite as [1], [2].',
].join('\n');

const parseRouterDecision = (value: string): RouterDecision | null => {
  const cleaned = value.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<RouterDecision>;
    if (typeof parsed.answer !== 'string') {
      return null;
    }
    return {
      answer: parsed.answer,
      needsOriginals: Boolean(parsed.needsOriginals),
      requestedArtifactIds: Array.isArray(parsed.requestedArtifactIds)
        ? parsed.requestedArtifactIds.filter((id): id is string => typeof id === 'string').slice(0, 3)
        : [],
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      suggested_actions: Array.isArray(parsed.suggested_actions)
        ? parsed.suggested_actions
            .filter((action): action is string => typeof action === 'string')
            .slice(0, 5)
        : undefined,
    };
  } catch {
    return null;
  }
};

const hashQuestion = (message: string) => createHash('sha256').update(message).digest('hex');

const writeChatRunArtifact = async (
  drive: ReturnType<typeof createDriveClient>,
  folderId: string,
  payload: {
    message: string;
    opened: Array<{ artifactId: string; source: 'gmail' | 'drive'; sourceId: string }>;
    truncatedCount: number;
    status: 'success' | 'partial' | 'failed';
    requestIds: string[];
    startedAt: string;
    finishedAt: string;
  },
) => {
  const runId = randomUUID();
  await drive.files.create({
    requestBody: {
      name: `ChatRun-${runId}.json`,
      parents: [folderId],
      mimeType: 'application/json',
    },
    media: {
      mimeType: 'application/json',
      body: JSON.stringify(
        {
          kind: 'chat_originals_opened',
          version: 1,
          startedAt: payload.startedAt,
          finishedAt: payload.finishedAt,
          questionHash: hashQuestion(payload.message),
          opened: payload.opened,
          counts: {
            openedCount: payload.opened.length,
            truncatedCount: payload.truncatedCount,
          },
          status: payload.status,
          requestIds: payload.requestIds,
        },
        null,
        2,
      ),
    },
    fields: 'id',
  });
};

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
  const allowOriginals = body?.allowOriginals === true;
  const advisorMode = body?.advisorMode === true;

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

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const drive = createDriveClient(accessToken);
  let driveFolderId: string | null = null;
  try {
    const folder = await resolveOrProvisionAppDriveFolder(drive, ctx);
    driveFolderId = folder?.id ?? null;
  } catch (error) {
    if (error instanceof AppDriveFolderResolveError) {
      logGoogleError(error.cause, error.operation, ctx);
      const mapped = mapGoogleError(error.cause, error.operation);
      logError(ctx, 'drive_folder_resolve_error', {
        status: mapped.status,
        code: mapped.code,
        error: safeError(error.cause),
      });
      return respond(
        jsonChatError(mapped.status, {
          error: { code: mapped.code, message: mapped.message, details: mapped.details },
          error_code: mapped.code,
          requestId: ctx.requestId,
        }),
      );
    }
    logError(ctx, 'drive_folder_resolve_error', {
      status: 500,
      code: 'upstream_error',
      error: safeError(error),
    });
    return respond(
      jsonChatError(500, {
        error: { code: 'upstream_error', message: 'Unable to resolve Drive folder.' },
        error_code: 'upstream_error',
        requestId: ctx.requestId,
      }),
    );
  }

  if (!driveFolderId) {
    return respond(
      jsonChatError(401, {
        error: { code: 'reconnect_required', message: 'Reconnect required.' },
        error_code: 'reconnect_required',
        requestId: ctx.requestId,
      }),
    );
  }

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
  const systemPrompt = buildChatSystemPrompt(adminSettings?.systemPrompt ?? '', advisorMode);
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
    { role: 'user' as const, content: ORIGINALS_ROUTER_PROMPT },
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

  const baseCitations: ChatCitation[] = items.map((item) => ({
    artifactId: item.artifactId,
    title: item.title,
    dateISO: item.dateISO,
    kind: item.kind,
  }));

  const routerDecision = llmProvider === 'stub' ? null : parseRouterDecision(llmResponseText);

  let reply =
    routerDecision?.answer ||
    llmResponseText ||
    (advisorMode
      ? formatAdvisorFallbackReply(items.length)
      : 'I could not find enough detail in your saved summaries. Try syncing or summarizing more items.');
  let citations = baseCitations;

  if (llmProvider !== 'stub' && !routerDecision) {
    reply = advisorMode
      ? formatAdvisorFallbackReply(items.length)
      : 'I could not parse the model response. Please try again.';
  }

  if (!allowOriginals && routerDecision?.needsOriginals) {
    reply = `${reply}\n\nEnable “Allow opening originals” to verify details.`;
  }

  if (allowOriginals && routerDecision?.needsOriginals) {
    const requestedSet = new Set(routerDecision.requestedArtifactIds.slice(0, MAX_REQUESTED_ORIGINALS));
    const candidates = items
      .filter((item) => requestedSet.has(item.artifactId))
      .slice(0, MAX_REQUESTED_ORIGINALS);
    const gmail = createGmailClient(accessToken);
    const openedOriginals: OpenedOriginal[] = [];
    const originalErrors: string[] = [];
    let totalChars = 0;

    for (const item of candidates) {
      try {
        const opened = await fetchOriginalTextForArtifact(drive, gmail, {
          artifactId: item.artifactId,
          title: item.title,
          source: item.source,
          sourceId: item.sourceId,
        });
        if (totalChars >= MAX_ORIGINAL_CHARS_TOTAL) {
          continue;
        }
        const remaining = MAX_ORIGINAL_CHARS_TOTAL - totalChars;
        const text = opened.text.length > remaining ? `${opened.text.slice(0, Math.max(0, remaining - 15)).trimEnd()}...[truncated]` : opened.text;
        totalChars += text.length;
        openedOriginals.push({ ...opened, text, truncated: opened.truncated || text !== opened.text });
      } catch (error) {
        originalErrors.push(`I couldn't open the original for SOURCE ${item.title} (${item.artifactId}).`);
        logWarn(ctx, 'chat_original_fetch_failed', {
          artifactId: item.artifactId,
          source: item.source,
          error: safeError(error),
        });
      }
    }

    if (openedOriginals.length > 0) {
      const originalContext = openedOriginals
        .map(
          (item, index) =>
            `ORIGINAL SOURCE ${index + 1} (${item.artifactId}): ${item.title}\n${item.text}`,
        )
        .join('\n\n');
      const pass2Messages = [
        ...(context
          ? [{ role: 'user' as const, content: `Summary context:\n${context}` }]
          : []),
        { role: 'user' as const, content: `Original context:\n${originalContext}` },
        {
          role: 'user' as const,
          content:
            'Use summary and original context to answer. Cite summary sources [1], [2] and original sources as [O1], [O2] when used.',
        },
        { role: 'user' as const, content: message || 'Summarize recent timeline context.' },
      ];

      try {
        const pass2 = await callLLM(llmProvider, {
          model: llmProvider === 'stub' ? 'stub' : model,
          systemPrompt,
          messages: pass2Messages,
          temperature: adminSettings?.temperature,
        });
        reply = pass2.text || (advisorMode ? formatAdvisorFallbackReply(items.length) : reply);
      } catch (error) {
        logWarn(ctx, 'chat_pass2_failed', { error: safeError(error) });
      }

      citations = [
        ...baseCitations,
        ...openedOriginals.map((item) => ({
          artifactId: item.artifactId,
          title: `${item.title} (original)`,
          kind: 'original' as const,
        })),
      ];

      if (originalErrors.length > 0) {
        reply = `${reply}\n\n${originalErrors.join(' ')}`;
      }

      try {
        await writeChatRunArtifact(drive, driveFolderId, {
          message,
          opened: openedOriginals.map((item) => ({
            artifactId: item.artifactId,
            source: item.source,
            sourceId: item.sourceId,
          })),
          truncatedCount: openedOriginals.filter((item) => item.truncated).length,
          status: originalErrors.length === 0 ? 'success' : 'partial',
          requestIds: [ctx.requestId],
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
        });
      } catch (error) {
        logWarn(ctx, 'chat_run_artifact_failed', { error: safeError(error) });
      }
    }
  }

  const responsePayload: ChatResponse = {
    reply,
    citations,
    suggested_actions:
      routerDecision?.suggested_actions && routerDecision.suggested_actions.length > 0
        ? uniqueActions(routerDecision.suggested_actions).slice(0, 5)
        : buildSuggestedActions(message, advisorMode),
    provider: { name: llmProvider, model: llmProvider === 'stub' ? 'stub' : model },
    requestId: ctx.requestId,
  };

  return respond(NextResponse.json(responsePayload));
}
