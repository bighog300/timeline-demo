import { afterEach, describe, expect, it } from 'vitest';

import { resolveGenericWebhookUrl, resolveSlackWebhookUrl } from './webhookTargets';

describe('webhookTargets', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('resolves env-backed targets by key', () => {
    process.env.SLACK_WEBHOOK_TEAM_A = 'https://hooks.slack.com/services/a/b/c';
    process.env.WEBHOOK_OPS = 'https://example.com/hook';

    expect(resolveSlackWebhookUrl('team_a')).toBe('https://hooks.slack.com/services/a/b/c');
    expect(resolveGenericWebhookUrl('OPS')).toBe('https://example.com/hook');
  });

  it('rejects invalid keys and missing values', () => {
    expect(resolveSlackWebhookUrl('https://hooks.slack.com/services/a/b/c')).toBeNull();
    expect(resolveGenericWebhookUrl('ops-team')).toBeNull();
    expect(resolveGenericWebhookUrl('MISSING')).toBeNull();
  });
});
