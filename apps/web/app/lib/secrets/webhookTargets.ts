const WEBHOOK_KEY_RE = /^[A-Z0-9_]+$/;

const normalizeKey = (key: string) => key.trim().toUpperCase();

const resolveByPrefix = (prefix: string, key: string): string | null => {
  const normalized = normalizeKey(key);
  if (!WEBHOOK_KEY_RE.test(normalized)) return null;
  const value = process.env[`${prefix}${normalized}`];
  if (!value || !value.trim()) return null;
  return value.trim();
};

export const isValidWebhookTargetKey = (key: string) => WEBHOOK_KEY_RE.test(normalizeKey(key));

export const resolveSlackWebhookUrl = (key: string): string | null => resolveByPrefix('SLACK_WEBHOOK_', key);

export const resolveGenericWebhookUrl = (key: string): string | null => resolveByPrefix('WEBHOOK_', key);
