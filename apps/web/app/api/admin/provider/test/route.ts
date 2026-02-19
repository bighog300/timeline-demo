import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { isAdminSession } from '../../../../lib/adminAuth';
import type { AdminSettings } from '../../../../lib/adminSettings';
import { createDefaultAdminSettings, normalizeAdminSettings } from '../../../../lib/adminSettings';
import { readAdminSettingsFromDrive } from '../../../../lib/adminSettingsDrive';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { parseTimelineProviderOutput } from '../../../../lib/llm/providerOutput';
import { ProviderError } from '../../../../lib/llm/providerErrors';
import { getTimelineProviderForSettings } from '../../../../lib/llm/providerRouter';
import { logError, logInfo, safeError } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

const MAX_SAMPLE_CHARS = 4000;

type ProviderTestPayload = {
  provider?: 'stub' | 'openai' | 'gemini';
  model?: string;
  systemPrompt?: string;
  summarizePromptTemplate?: string;
  highlightsPromptTemplate?: string;
  maxOutputTokens?: number;
  temperature?: number;
  sampleTitle?: string;
  sampleText?: string;
  sampleSource?: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseBody = (value: unknown): ProviderTestPayload | null => {
  if (!isObject(value)) return null;

  const allowedKeys = new Set([
    'provider',
    'model',
    'systemPrompt',
    'summarizePromptTemplate',
    'highlightsPromptTemplate',
    'maxOutputTokens',
    'temperature',
    'sampleTitle',
    'sampleText',
    'sampleSource',
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return null;
  }

  const provider = value.provider;
  if (provider !== undefined && provider !== 'stub' && provider !== 'openai' && provider !== 'gemini') {
    return null;
  }

  const stringFields: Array<keyof Pick<
    ProviderTestPayload,
    'model' | 'systemPrompt' | 'summarizePromptTemplate' | 'highlightsPromptTemplate' | 'sampleTitle' | 'sampleText' | 'sampleSource'
  >> = [
    'model',
    'systemPrompt',
    'summarizePromptTemplate',
    'highlightsPromptTemplate',
    'sampleTitle',
    'sampleText',
    'sampleSource',
  ];

  for (const field of stringFields) {
    const fieldValue = value[field];
    if (fieldValue !== undefined && typeof fieldValue !== 'string') {
      return null;
    }
  }

  if (value.maxOutputTokens !== undefined && typeof value.maxOutputTokens !== 'number') {
    return null;
  }
  if (value.temperature !== undefined && typeof value.temperature !== 'number') {
    return null;
  }

  return value as ProviderTestPayload;
};

const buildMergedSettings = (current: AdminSettings, overrides: ProviderTestPayload) => {
  const next: AdminSettings = {
    ...current,
    routing: {
      ...current.routing,
      default: { ...current.routing.default },
      ...(current.routing.tasks
        ? {
            tasks: {
              ...(current.routing.tasks.chat ? { chat: { ...current.routing.tasks.chat } } : {}),
              ...(current.routing.tasks.summarize
                ? { summarize: { ...current.routing.tasks.summarize } }
                : {}),
            },
          }
        : {}),
    },
    prompts: { ...current.prompts },
    tasks: {
      chat: { ...current.tasks.chat },
      summarize: { ...current.tasks.summarize },
    },
    safety: { ...current.safety },
  };

  if (overrides.provider !== undefined) next.routing.default.provider = overrides.provider;
  if (overrides.model !== undefined) next.routing.default.model = overrides.model;
  if (overrides.systemPrompt !== undefined) next.prompts.system = overrides.systemPrompt;
  if (overrides.summarizePromptTemplate !== undefined)
    next.prompts.summarizePromptTemplate = overrides.summarizePromptTemplate;
  if (overrides.highlightsPromptTemplate !== undefined)
    next.prompts.highlightsPromptTemplate = overrides.highlightsPromptTemplate;
  if (overrides.maxOutputTokens !== undefined) next.tasks.summarize.maxOutputTokens = overrides.maxOutputTokens;
  if (overrides.temperature !== undefined) next.tasks.summarize.temperature = overrides.temperature;

  return next;
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/admin/provider/test');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  if (!isAdminSession(session)) {
    return respond(jsonError(403, 'forbidden', 'Access denied.'));
  }

  if (!session.driveFolderId) {
    return respond(jsonError(400, 'bad_request', 'Drive folder not provisioned.'));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(jsonError(400, 'bad_request', 'Invalid request payload.'));
  }

  const parsedBody = parseBody(body);
  if (!parsedBody) {
    return respond(jsonError(400, 'bad_request', 'Invalid request payload.'));
  }

  try {
    const drive = createDriveClient(accessToken);
    const { settings: loadedSettings } = await readAdminSettingsFromDrive(drive, session.driveFolderId, ctx);
    const baseSettings = normalizeAdminSettings(loadedSettings) ?? createDefaultAdminSettings();

    const mergedSettings = buildMergedSettings(baseSettings, parsedBody);
    const provider = getTimelineProviderForSettings(mergedSettings);

    const sampleTitle = parsedBody.sampleTitle ?? 'Test Document';
    const sampleText = (
      parsedBody.sampleText ??
      'This is a short sample paragraph used to verify provider configuration in admin settings.'
    ).slice(0, MAX_SAMPLE_CHARS);

    const started = Date.now();
    const providerResult = await provider.summarize(
      {
        title: sampleTitle,
        text: sampleText,
        source: parsedBody.sampleSource ?? 'admin_test',
        sourceMetadata: { mode: 'admin_test' },
      },
      mergedSettings,
    );
    const timings = { ms: Date.now() - started };

    try {
      const validated = parseTimelineProviderOutput(
        JSON.stringify({ summary: providerResult.summary, highlights: providerResult.highlights }),
      );

      return respond(
        NextResponse.json({
          provider: mergedSettings.routing.default.provider,
          model: mergedSettings.routing.default.model,
          summary: validated.summary,
          highlights: validated.highlights,
          timings,
        }),
      );
    } catch {
      return respond(jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'));
    }
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'not_configured') {
      return respond(jsonError(500, 'provider_not_configured', 'Selected provider is not configured.'));
    }

    if (error instanceof ProviderError && error.code === 'bad_output') {
      return respond(jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'));
    }

    logError(ctx, 'provider_test_error', { error: safeError(error) });
    return respond(jsonError(500, 'internal_error', 'Unexpected server error.'));
  }
};
