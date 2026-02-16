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
import { isProviderError } from '../../lib/llm/providerErrors';
import { callLLM } from '../../lib/llm/index';
import type { LLMProviderName } from '../../lib/llm/types';
import { hashUserHint, logError, logInfo, logWarn, safeError } from '../../lib/logger';
import {
  fetchOriginalTextForArtifact,
  MAX_ORIGINAL_CHARS_TOTAL,
  type OpenedOriginal,
} from '../../lib/originals';
import { createCtx, withRequestId } from '../../lib/requestContext';

type ChatCitation =
  | {
      artifactId: string;
      title: string;
      dateISO?: string;
      kind: 'summary' | 'index' | 'original';
    }
  | {
      artifactId: string;
      title: string;
      kind: 'selection_set';
      selectionSetId: string;
    }
  | {
      artifactId: string;
      title: string;
      kind: 'run';
      runId: string;
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
  error: { code: string; message?: string; details?: unknown; retryAfterSec?: number };
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

const SYNTHESIS_PROMPT_ADDENDUM = [
  'You are performing timeline synthesis across SOURCES.',
  'Use only provided SOURCES; do not invent facts.',
  'Prefer dates from summaries; if missing, infer relative order but label as “date not specified”.',
  'Extract key events as normalized bullets:',
  '- Date/Time (or “Unknown”)',
  '- Actor(s)',
  '- Action',
  '- Evidence (citations)',
  '- Relevance/Impact',
  'Extract entities in categories: Person, Organization, Location, Case/Claim/Matter, Document/Artifact.',
  'Create a canonical label per entity: prefer Name <email> when email exists, otherwise most complete name.',
  'Track aliases for each canonical entity and mark weak matches as “possible alias”.',
  'Identify key actors/entities and how they relate.',
  'Identify themes and turning points, citing evidence.',
  'Include cautious “Legal considerations (general)” and “Psychological/interpersonal signals (non-clinical)” sections tied to specific events (cite each).',
  'If context limits are tight, prioritize the 10 most relevant events.',
  'If the user request is broad, prefer the most recent relevant summaries.',
  'Output MUST include these headings, in this order:',
  '',
  '## Synthesized timeline',
  '(chronological table-like bullets; max 10 events; each event includes Date/Actor(s)/Action/Outcome-Impact/Evidence [#]; omit uncited events)',
  '',
  '## Key actors and entities',
  '(list with canonical labels, aliases/possible aliases, brief roles, and citations)',
  '',
  '## Actor timelines',
  '(for top 3-5 actors: chronological bullets with Date/Actor(s)/Action/Outcome-Impact/Evidence [#]; omit any uncited event)',
  '',
  '## Themes grouped view',
  '(group into 4-8 themes; include turning points and cross-actor interactions; cite every bullet)',
  '',
  '## Themes and turning points',
  '(bullets; cite)',
  '',
  '## Legal considerations (general information)',
  '(issue-spotting bullets; cite; include “Not legal advice.”)',
  '',
  '## Psychological and interpersonal signals (non-clinical)',
  '(signals/dynamics bullets; cite; include “Not a diagnosis.”)',
  '',
  '## Contradictions and uncertainties',
  '(list conflicting dates/claims, unresolved identity mapping, and missing source coverage; cite)',
  '',
  '## Questions to clarify',
  '(up to 5)',
  '',
  '## Suggested next steps',
  '(actionable next steps; may suggest enabling originals if needed)',
].join('\n');

type SynthesisEntity = {
  id: string;
  type: 'person' | 'org' | 'location' | 'matter' | 'document';
  canonical: string;
  aliases: string[];
  confidence: 'high' | 'medium' | 'low';
  citations: number[];
};

type SynthesisEvent = {
  id: string;
  dateISO: string | null;
  dateLabel: string;
  actors: string[];
  summary: string;
  theme: string;
  impact: string;
  citations: number[];
};

type SynthesisPlan = {
  entities: SynthesisEntity[];
  events: SynthesisEvent[];
};

type CountingOccurrence = {
  who: string;
  action: string;
  when: string | null;
  where: string | null;
  evidence: string;
  citations: number[];
};

type CountingExtraction = {
  occurrences: CountingOccurrence[];
  notes: string | null;
};

const SYNTHESIS_PLAN_LIMITS = {
  entities: 25,
  events: 15,
};

const extractJsonObjectFromText = (value: string): unknown | null => {
  const cleaned = value.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
      return null;
    }
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
};

const parseSynthesisPlan = (value: string, sourceCount: number): SynthesisPlan | null => {
  const parsed = extractJsonObjectFromText(value) as Partial<SynthesisPlan> | null;
  if (!parsed || !Array.isArray(parsed.entities) || !Array.isArray(parsed.events)) {
    return null;
  }

  const inRangeCitations = (citations: unknown): number[] =>
    Array.isArray(citations)
      ? citations
          .filter((citation): citation is number => Number.isInteger(citation))
          .filter((citation) => citation >= 1 && citation <= sourceCount)
      : [];

  const entities = parsed.entities
    .map((entity) => {
      if (!entity || typeof entity !== 'object') {
        return null;
      }
      const typed = entity as Partial<SynthesisEntity>;
      if (
        typeof typed.id !== 'string' ||
        typeof typed.canonical !== 'string' ||
        !['person', 'org', 'location', 'matter', 'document'].includes(typed.type as string)
      ) {
        return null;
      }
      const confidence = ['high', 'medium', 'low'].includes(typed.confidence as string)
        ? (typed.confidence as SynthesisEntity['confidence'])
        : 'low';
      return {
        id: typed.id,
        type: typed.type as SynthesisEntity['type'],
        canonical: typed.canonical,
        aliases: Array.isArray(typed.aliases)
          ? typed.aliases.filter((alias): alias is string => typeof alias === 'string').slice(0, 6)
          : [],
        confidence,
        citations: inRangeCitations(typed.citations),
      };
    })
    .filter((entity): entity is SynthesisEntity => entity !== null)
    .slice(0, SYNTHESIS_PLAN_LIMITS.entities);

  const events = parsed.events
    .map((event) => {
      if (!event || typeof event !== 'object') {
        return null;
      }
      const typed = event as Partial<SynthesisEvent>;
      if (typeof typed.id !== 'string' || typeof typed.summary !== 'string') {
        return null;
      }
      return {
        id: typed.id,
        dateISO: typeof typed.dateISO === 'string' ? typed.dateISO : null,
        dateLabel: typeof typed.dateLabel === 'string' ? typed.dateLabel : 'Unknown',
        actors: Array.isArray(typed.actors)
          ? typed.actors.filter((actor): actor is string => typeof actor === 'string').slice(0, 5)
          : [],
        summary: typed.summary,
        theme: typeof typed.theme === 'string' ? typed.theme : 'general',
        impact: typeof typed.impact === 'string' ? typed.impact : 'impact unclear',
        citations: inRangeCitations(typed.citations),
      };
    })
    .filter((event): event is SynthesisEvent => event !== null)
    .filter((event) => event.citations.length > 0)
    .slice(0, SYNTHESIS_PLAN_LIMITS.events);

  return { entities, events };
};

const buildChatSystemPrompt = (
  systemPrompt: string,
  advisorMode: boolean,
  synthesisMode: boolean,
) => {
  const promptParts = [buildSystemPrompt(systemPrompt)];
  if (advisorMode || synthesisMode) {
    promptParts.push(ADVISOR_PROMPT_ADDENDUM);
  }
  if (synthesisMode) {
    promptParts.push(SYNTHESIS_PROMPT_ADDENDUM);
  }
  return promptParts.filter(Boolean).join('\n\n');
};

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

const formatSynthesisFallbackReply = (sourceCount: number) => {
  const sourceLabel = sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : 'no sources';
  return [
    '## Synthesized timeline',
    sourceCount > 0
      ? `- Date/Time: Unknown | Actor(s): Unspecified | Action: Reviewed ${sourceLabel}. | Evidence: [1] | Relevance/Impact: Establishes baseline chronology [1].`
      : '- Date/Time: Unknown | Actor(s): Unknown | Action: Not enough evidence in the provided sources. | Evidence: none | Relevance/Impact: Additional sources are needed.',
    '',
    '## Key actors and entities',
    sourceCount > 0
      ? '- Available summaries reference timeline participants, but specific roles remain limited in the current context [1].'
      : '- Not enough evidence in the provided sources.',
    '',
    '## Actor timelines',
    '- Actor: Unspecified | Date/Time: Unknown | Action: Insufficient grounded detail for actor-specific chronology [1].',
    '',
    '## Themes grouped view',
    '- Theme: chronology baseline | Events remain high-level until additional grounded details are available [1].',
    '',
    '## Themes and turning points',
    '- A potential escalation-to-resolution pattern may be present, pending fuller date coverage [1].',
    '',
    '## Legal considerations (general information)',
    '- Depending on full facts, contractual, employment, confidentiality, or safeguarding issues may be relevant [1].',
    '- Not legal advice.',
    '',
    '## Psychological and interpersonal signals (non-clinical)',
    '- The available records may suggest stress or communication-strain dynamics, but evidence is limited [1].',
    '- Not a diagnosis.',
    '',
    '## Contradictions and uncertainties',
    '- Dates and actor-level attribution are incomplete in the provided summaries [1].',
    '- Identity mapping remains unresolved for some participants (possible aliases) [1].',
    '',
    '## Questions to clarify',
    '- Which event date should be verified first?',
    '- Which source should be opened to resolve missing detail?',
    '',
    '## Suggested next steps',
    '- Open originals for SOURCE 1 and SOURCE 2 if exact wording matters.',
    '- Summarize additional timeline documents covering the same period.',
    '- Review contradictions around key dates and participants.',
  ].join('\n');
};

const uniqueActions = (actions: string[]) => Array.from(new Set(actions));

const isCountingQuestion = (message: string) =>
  /\b(how many times|how often|number of|count|how many)\b/i.test(message);

const parseCountingExtraction = (value: string, sourceCount: number): CountingExtraction | null => {
  const parsed = extractJsonObjectFromText(value) as Partial<CountingExtraction> | null;
  if (!parsed || !Array.isArray(parsed.occurrences)) {
    return null;
  }

  const occurrences = parsed.occurrences
    .map((occurrence) => {
      if (!occurrence || typeof occurrence !== 'object') {
        return null;
      }
      const typed = occurrence as Partial<CountingOccurrence>;
      if (
        typeof typed.who !== 'string' ||
        typeof typed.action !== 'string' ||
        typeof typed.evidence !== 'string'
      ) {
        return null;
      }
      const citations = Array.isArray(typed.citations)
        ? typed.citations
            .filter((citation): citation is number => Number.isInteger(citation))
            .filter((citation) => citation >= 1 && citation <= sourceCount)
        : [];
      if (citations.length === 0) {
        return null;
      }
      return {
        who: typed.who,
        action: typed.action,
        when: typeof typed.when === 'string' ? typed.when : null,
        where: typeof typed.where === 'string' ? typed.where : null,
        evidence: typed.evidence,
        citations,
      };
    })
    .filter((occurrence): occurrence is CountingOccurrence => occurrence !== null);

  return {
    occurrences,
    notes: typeof parsed.notes === 'string' ? parsed.notes : null,
  };
};

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

const buildSuggestedActions = (message: string, advisorMode = false, synthesisMode = false) => {
  if (synthesisMode) {
    return [
      'Open originals for SOURCE 1 and SOURCE 2',
      'Summarize these additional emails/files for missing timeline dates',
      'Create/refresh an index for the key timeline topic',
      'Tag events as escalation, agreement, and follow-up',
      'Review contradictions around a disputed date or person',
    ];
  }

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

const EMPTY_SOURCE_GUIDANCE_STEPS = [
  'Go to /timeline and click Full sync',
  'Summarize items in /select/gmail or /select/drive',
];

const buildNoSourceGuidanceResponse = ({
  synthesisMode,
  sourceCount,
  provider,
  model,
  requestId,
}: {
  synthesisMode: boolean;
  sourceCount: number;
  provider: LLMProviderName;
  model: string;
  requestId: string;
}): ChatResponse => ({
  reply:
    synthesisMode && sourceCount < 2
      ? 'Need at least 2 sources to synthesize a timeline.'
      : 'No timeline sources available to analyze.',
  citations: [],
  suggested_actions: EMPTY_SOURCE_GUIDANCE_STEPS,
  provider: { name: provider, model },
  requestId,
});

const jsonChatError = (status: number, payload: ChatErrorResponse) =>
  NextResponse.json(payload, { status });

const MAX_REQUESTED_ORIGINALS = 3;

const buildOriginalsRouterPrompt = (synthesisMode: boolean) => [
  'Return valid JSON only with keys: answer, needsOriginals, requestedArtifactIds, reason, suggested_actions.',
  'requestedArtifactIds must include only SOURCE artifact ids from context and at most 3 entries.',
  'Set needsOriginals=true only if details are unavailable from summaries and originals are needed.',
  'Keep answer grounded in summaries and cite as [1], [2].',
  ...(synthesisMode
    ? [
        'answer must use synthesis headings in this order: ## Synthesized timeline; ## Key actors and entities; ## Themes and turning points; ## Legal considerations (general information); ## Psychological and interpersonal signals (non-clinical); ## Contradictions and uncertainties; ## Questions to clarify; ## Suggested next steps.',
        'for synthesis, also include headings ## Actor timelines and ## Themes grouped view immediately after ## Key actors and entities.',
        'suggested_actions should include 3 to 5 actionable synthesis-focused items.',
      ]
    : []),
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
  const rawMessage = typeof body?.message === 'string' ? body.message : '';
  const message = rawMessage.trim();
  const queryTextForContext = message === '' ? 'recent' : rawMessage;
  const allowOriginals = body?.allowOriginals === true;
  const advisorMode = body?.advisorMode === true;
  const synthesisMode = body?.synthesisMode === true;
  const countingMode = !synthesisMode && isCountingQuestion(message);
  const effectiveAdvisorMode = advisorMode || synthesisMode;

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
      queryText: queryTextForContext,
      drive,
      driveFolderId,
      maxItems: maxContextItems,
      ctx,
      synthesisMode,
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
  const summaryItems = items.filter(
    (item): item is Extract<(typeof items)[number], { kind: 'summary' }> => item.kind === 'summary',
  );
  const summaryCount = summaryItems.length;
  const systemPrompt = buildChatSystemPrompt(
    adminSettings?.systemPrompt ?? '',
    effectiveAdvisorMode,
    synthesisMode,
  );
  const provider = adminSettings?.provider ?? 'stub';
  const model = adminSettings?.model ?? 'stub';

  if ((synthesisMode && summaryCount < 2) || summaryCount === 0) {
    return respond(
      NextResponse.json(
        buildNoSourceGuidanceResponse({
          synthesisMode,
          sourceCount: summaryCount,
          provider,
          model,
          requestId: ctx.requestId,
        }),
      ),
    );
  }

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
    {
      role: 'user' as const,
      content: countingMode
        ? 'Return STRICT JSON only with shape {"occurrences":[{"who":"...","action":"...","when":null,"where":null,"evidence":"...","citations":[1]}],"notes":null}. Extract discrete occurrences needed to answer the counting question using summary sources only. Each occurrence MUST include at least one citation like [1] referencing SOURCE numbers. If evidence is insufficient to count reliably, return an empty occurrences array and explain uncertainty in notes. No prose outside JSON.'
        : buildOriginalsRouterPrompt(synthesisMode),
    },
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
    if (isProviderError(error)) {
      if (error.code === 'not_configured') {
        const isAdmin = isAdminSession(session);
        if (isAdmin) {
          return respond(
            jsonChatError(400, {
              error: {
                code: 'not_configured',
                message: 'Chat provider is not configured.',
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
        const details = error.details
          ? {
              providerStatus: error.details.providerStatus,
              ...(error.details.providerMessage
                ? { providerMessage: error.details.providerMessage.slice(0, 200) }
                : {}),
            }
          : undefined;

        const payloadByCode: Record<
          Exclude<typeof error.code, 'not_configured'>,
          {
            status: number;
            code: string;
            message: string;
            includeDetails?: boolean;
          }
        > = {
          invalid_request: {
            status: 400,
            code: 'invalid_request',
            message: 'Chat provider rejected the request (check model/settings).',
            includeDetails: true,
          },
          unauthorized: {
            status: 401,
            code: 'provider_unauthorized',
            message: 'Chat provider credentials are invalid or expired.',
          },
          forbidden: {
            status: 403,
            code: 'provider_forbidden',
            message: 'Chat provider request was forbidden.',
          },
          rate_limited: {
            status: 429,
            code: 'rate_limited',
            message: 'Chat provider rate limit exceeded. Try again later.',
          },
          upstream_timeout: {
            status: 504,
            code: 'upstream_timeout',
            message: 'Chat provider timed out.',
          },
          upstream_error: {
            status: 502,
            code: 'upstream_error',
            message: 'Chat provider error. Please retry.',
          },
        };

        const mapped = payloadByCode[error.code];
        logError(ctx, 'llm_provider_error', {
          code: error.code,
          provider: error.provider,
          status: mapped.status,
          details,
        });
        return respond(
          jsonChatError(mapped.status, {
            error: {
              code: mapped.code,
              message: mapped.message,
              ...(mapped.includeDetails && details ? { details } : {}),
              ...(error.code === 'rate_limited' && error.retryAfterSec !== undefined
                ? { retryAfterSec: error.retryAfterSec }
                : {}),
            },
            error_code: mapped.code,
            requestId: ctx.requestId,
          }),
        );
      }
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

  const baseCitations: ChatCitation[] = items.map((item) => {
    if (item.kind === 'summary') {
      return {
        artifactId: item.artifactId,
        title: item.title,
        dateISO: item.dateISO,
        kind: item.kind,
      };
    }

    if (item.kind === 'selection_set') {
      return {
        artifactId: item.id,
        title: item.title,
        kind: 'selection_set',
        selectionSetId: item.id,
      };
    }

    return {
      artifactId: item.id,
      title: item.selectionSetTitle ? `Run ${item.id} (${item.selectionSetTitle})` : `Run ${item.id}`,
      kind: 'run',
      runId: item.id,
    };
  });

  const routerDecision = countingMode || llmProvider === 'stub' ? null : parseRouterDecision(llmResponseText);

  let citations = baseCitations;
  let countingReply: string | null = null;
  let countingActions: string[] | null = null;

  if (countingMode) {
    const extraction = parseCountingExtraction(llmResponseText, summaryCount);
    const occurrences = extraction?.occurrences ?? [];
    const citationIndexes = Array.from(new Set(occurrences.flatMap((occurrence) => occurrence.citations))).sort(
      (a, b) => a - b,
    );

    if (occurrences.length === 0) {
      countingReply =
        'I can’t confirm from summaries alone. Please enable “Allow opening originals” to verify the exact count.';
      countingActions = uniqueActions([
        'Enable “Allow opening originals” to verify the exact wording in source documents.',
        'Summarize additional related documents if more timeline coverage is needed.',
      ]);
    } else {
      const lines = occurrences
        .slice(0, 5)
        .map((occurrence, index) => {
          const whenLabel = occurrence.when ? ` (${occurrence.when})` : '';
          const cited = occurrence.citations.map((citation) => `[${citation}]`).join(', ');
          return `${index + 1}. ${occurrence.who} — ${occurrence.action}${whenLabel} ${cited}`;
        })
        .join('\n');
      const notesLine = extraction?.notes ? `\n\nNotes: ${extraction.notes}` : '';
      countingReply = `Based on the available summaries, I found ${occurrences.length} occurrence${occurrences.length === 1 ? '' : 's'} supported by citations.\n\n${lines}${notesLine}`;
      countingActions = uniqueActions([
        'Enable “Allow opening originals” if you want line-by-line verification of each occurrence.',
      ]);
    }

    if (citationIndexes.length > 0) {
      const summaryByIndex = new Map(summaryItems.map((item, index) => [index + 1, item]));
      const groundedSummaryCitations = citationIndexes
        .map((citationIndex) => summaryByIndex.get(citationIndex))
        .filter((item): item is (typeof summaryItems)[number] => item !== undefined)
        .map((item) => ({
          artifactId: item.artifactId,
          title: item.title,
          dateISO: item.dateISO,
          kind: 'summary' as const,
        }));

      if (groundedSummaryCitations.length > 0) {
        citations = groundedSummaryCitations;
      }
    }
  }

  let synthesisPlanReply: string | null = null;
  if (synthesisMode && llmProvider !== 'stub') {
    try {
      const extraction = await callLLM(llmProvider, {
        model,
        systemPrompt,
        messages: [
          ...(context
            ? [{ role: 'user' as const, content: `SOURCES:
${context}` }]
            : []),
          { role: 'user' as const, content: message || 'Synthesize recent timeline context.' },
          {
            role: 'user' as const,
            content:
              'Return STRICT JSON only with shape {"entities":[{"id":"e1","type":"person|org|location|matter|document","canonical":"...","aliases":["..."],"confidence":"high|medium|low","citations":[1]}],"events":[{"id":"v1","dateISO":null,"dateLabel":"Unknown","actors":["e1"],"summary":"...","theme":"...","impact":"...","citations":[1]}]}. Entity normalization: prefer Name <email> when email appears; otherwise most complete name. Include aliases and mark uncertain links as possible aliases via low confidence aliases. Event grouping: keep only cited events and omit uncited events.',
          },
        ],
        temperature: adminSettings?.temperature,
      });
      const plan = parseSynthesisPlan(extraction.text, summaryCount);
      if (plan) {
        const writeup = await callLLM(llmProvider, {
          model,
          systemPrompt,
          messages: [
            ...(context
              ? [{ role: 'user' as const, content: `SOURCES:
${context}` }]
              : []),
            { role: 'user' as const, content: `PLAN JSON:
${JSON.stringify(plan)}` },
            {
              role: 'user' as const,
              content:
                'Write final synthesis using PLAN + SOURCES. Keep required heading order including ## Actor timelines and ## Themes grouped view after ## Key actors and entities. In ## Synthesized timeline provide at most 10 events and each bullet must include Date/Actor(s)/Action/Outcome-Impact/Evidence [#]. Omit any event that lacks citations. In contradictions call out conflicting dates/claims, unresolved identity mappings, and missing source coverage.',
            },
            { role: 'user' as const, content: message || 'Synthesize recent timeline context.' },
          ],
          temperature: adminSettings?.temperature,
        });
        if (writeup.text.trim()) {
          synthesisPlanReply = writeup.text;
        }
      }
    } catch (error) {
      logWarn(ctx, 'synthesis_plan_failed', { error: safeError(error) });
    }
  }

  let reply =
    countingReply ||
    synthesisPlanReply ||
    routerDecision?.answer ||
    llmResponseText ||
    (synthesisMode
      ? formatSynthesisFallbackReply(summaryCount)
      : effectiveAdvisorMode
      ? formatAdvisorFallbackReply(summaryCount)
      : 'I could not find enough detail in your saved summaries. Try syncing or summarizing more items.');
  if (llmProvider !== 'stub' && !countingMode && !routerDecision && !synthesisPlanReply) {
    reply = synthesisMode
      ? formatSynthesisFallbackReply(summaryCount)
      : effectiveAdvisorMode
      ? formatAdvisorFallbackReply(summaryCount)
      : 'I could not parse the model response. Please try again.';
  }

  if (!allowOriginals && routerDecision?.needsOriginals) {
    reply = `${reply}\n\nEnable “Allow opening originals” to verify details.`;
  }

  if (allowOriginals && routerDecision?.needsOriginals) {
    const requestedSet = new Set(routerDecision.requestedArtifactIds.slice(0, MAX_REQUESTED_ORIGINALS));
    const candidates = items
      .filter((item): item is Extract<(typeof items)[number], { kind: 'summary' }> => item.kind === 'summary')
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
          content: synthesisMode
            ? 'Use summary and original context to answer in synthesis format. Keep required headings and order. Cite summary sources [1], [2] and original sources as [O1], [O2] when used.'
            : 'Use summary and original context to answer. Cite summary sources [1], [2] and original sources as [O1], [O2] when used.',
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
        reply =
          pass2.text ||
          (synthesisMode
            ? formatSynthesisFallbackReply(summaryCount)
            : effectiveAdvisorMode
            ? formatAdvisorFallbackReply(summaryCount)
            : reply);
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
      countingActions && countingActions.length > 0
        ? countingActions.slice(0, 5)
        : routerDecision?.suggested_actions && routerDecision.suggested_actions.length > 0
        ? uniqueActions(routerDecision.suggested_actions).slice(0, 5)
        : buildSuggestedActions(message, effectiveAdvisorMode, synthesisMode),
    provider: { name: llmProvider, model: llmProvider === 'stub' ? 'stub' : model },
    requestId: ctx.requestId,
  };

  return respond(NextResponse.json(responsePayload));
}
