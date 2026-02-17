import { describe, expect, it, vi } from 'vitest';

vi.mock('../adminSettingsDrive', () => ({
  readAdminSettingsFromDrive: vi.fn(),
}));

import { readAdminSettingsFromDrive } from '../adminSettingsDrive';
import { ProviderError } from './providerErrors';
import { getTimelineProviderForSettings, getTimelineProviderFromDrive } from './providerRouter';

const mockReadAdminSettingsFromDrive = vi.mocked(readAdminSettingsFromDrive);

describe('timeline provider router', () => {
  it('defaults to stub provider path when settings are missing', async () => {
    mockReadAdminSettingsFromDrive.mockResolvedValue({
      settings: {
        type: 'admin_settings',
        version: 1,
        provider: 'stub',
        model: 'stub-model',
        systemPrompt: '',
        maxContextItems: 8,
        temperature: 0.2,
        updatedAtISO: '2026-01-01T00:00:00Z',
      },
    } as never);

    const { provider, settings } = await getTimelineProviderFromDrive({} as never, 'folder-1');
    const result = await provider.summarize({ title: 'T', text: 'Body' }, settings);

    expect(settings.provider).toBe('stub');
    expect(result.model).toBe('stub-model');
  });

  it('uses AdminSettings.provider for selection', () => {
    process.env.OPENAI_API_KEY = 'test';
    const provider = getTimelineProviderForSettings({
      type: 'admin_settings',
      version: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: '',
      maxContextItems: 8,
      temperature: 0.2,
      updatedAtISO: '2026-01-01T00:00:00Z',
    });

    expect(provider).toBeDefined();
    delete process.env.OPENAI_API_KEY;
  });

  it('throws not_configured when openai key is missing', () => {
    delete process.env.OPENAI_API_KEY;

    expect(() =>
      getTimelineProviderForSettings({
        type: 'admin_settings',
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        maxContextItems: 8,
        temperature: 0.2,
        updatedAtISO: '2026-01-01T00:00:00Z',
      }),
    ).toThrowError(ProviderError);
  });
});
