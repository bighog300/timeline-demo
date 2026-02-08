import type { LLMProviderName } from './llm/types';

export type AdminSettings = {
  type: 'admin_settings';
  version: 1;
  provider: LLMProviderName;
  model: string;
  systemPrompt: string;
  maxContextItems: number;
  temperature: number;
  updatedAtISO: string;
};

export type AdminSettingsInput = {
  provider?: LLMProviderName;
  model?: string;
  systemPrompt?: string;
  maxContextItems?: number;
  temperature?: number;
};

export const DEFAULT_ADMIN_SETTINGS: Omit<AdminSettings, 'updatedAtISO'> = {
  type: 'admin_settings',
  version: 1,
  provider: 'stub',
  model: 'gpt-4o-mini',
  systemPrompt: '',
  maxContextItems: 8,
  temperature: 0.2,
};

const isProviderName = (value: unknown): value is LLMProviderName =>
  value === 'stub' || value === 'openai' || value === 'gemini';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const createDefaultAdminSettings = (nowISO = new Date().toISOString()): AdminSettings => ({
  ...DEFAULT_ADMIN_SETTINGS,
  updatedAtISO: nowISO,
});

export const normalizeAdminSettings = (
  value: unknown,
  nowISO = new Date().toISOString(),
): AdminSettings | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== 'admin_settings' || record.version !== 1) {
    return null;
  }

  const provider = isProviderName(record.provider) ? record.provider : DEFAULT_ADMIN_SETTINGS.provider;
  const model = typeof record.model === 'string' ? record.model : DEFAULT_ADMIN_SETTINGS.model;
  const systemPrompt =
    typeof record.systemPrompt === 'string' ? record.systemPrompt : DEFAULT_ADMIN_SETTINGS.systemPrompt;
  const maxContextItems = isNumber(record.maxContextItems)
    ? record.maxContextItems
    : DEFAULT_ADMIN_SETTINGS.maxContextItems;
  const temperature = isNumber(record.temperature)
    ? record.temperature
    : DEFAULT_ADMIN_SETTINGS.temperature;
  const updatedAtISO =
    typeof record.updatedAtISO === 'string' && record.updatedAtISO.trim()
      ? record.updatedAtISO
      : nowISO;

  return {
    type: 'admin_settings',
    version: 1,
    provider,
    model,
    systemPrompt,
    maxContextItems,
    temperature,
    updatedAtISO,
  };
};

export const validateAdminSettingsInput = (
  value: unknown,
  nowISO = new Date().toISOString(),
): { settings?: AdminSettings; error?: string } => {
  if (!value || typeof value !== 'object') {
    return { error: 'Settings payload must be an object.' };
  }

  const record = value as Record<string, unknown>;
  if (!isProviderName(record.provider)) {
    return { error: 'Provider must be one of: stub, openai, gemini.' };
  }

  if (typeof record.model !== 'string') {
    return { error: 'Model must be a string.' };
  }

  if (typeof record.systemPrompt !== 'string') {
    return { error: 'System prompt must be a string.' };
  }

  const maxContextItems =
    record.maxContextItems === undefined
      ? DEFAULT_ADMIN_SETTINGS.maxContextItems
      : isNumber(record.maxContextItems)
        ? record.maxContextItems
        : null;
  if (maxContextItems === null) {
    return { error: 'maxContextItems must be a number.' };
  }

  const temperature =
    record.temperature === undefined
      ? DEFAULT_ADMIN_SETTINGS.temperature
      : isNumber(record.temperature)
        ? record.temperature
        : null;
  if (temperature === null) {
    return { error: 'temperature must be a number.' };
  }

  return {
    settings: {
      type: 'admin_settings',
      version: 1,
      provider: record.provider,
      model: record.model,
      systemPrompt: record.systemPrompt,
      maxContextItems,
      temperature,
      updatedAtISO: nowISO,
    },
  };
};
