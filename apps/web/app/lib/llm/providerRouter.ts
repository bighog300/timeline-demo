import type { drive_v3 } from 'googleapis';

import type { AdminSettings } from '../adminSettings';
import { readAdminSettingsFromDrive } from '../adminSettingsDrive';
import type { LogContext } from '../logger';
import { ProviderError } from './providerErrors';
import { geminiTimelineProvider } from './providers/timelineGemini';
import { openaiTimelineProvider } from './providers/timelineOpenai';
import { stubTimelineProvider } from './providers/timelineStub';
import type { TimelineProvider } from './providers/types';

export type ResolvedProviderModel = {
  provider: AdminSettings['routing']['default']['provider'];
  model: string;
};

export const getTimelineProviderForResolved = (resolved: ResolvedProviderModel): TimelineProvider => {
  switch (resolved.provider) {
    case 'stub':
      return stubTimelineProvider;
    case 'openai':
      if (!process.env.OPENAI_API_KEY) {
        throw new ProviderError({
          code: 'not_configured',
          status: 500,
          provider: 'openai',
          message: 'Provider not configured.',
        });
      }
      return openaiTimelineProvider;
    case 'gemini':
      if (!process.env.GEMINI_API_KEY) {
        throw new ProviderError({
          code: 'not_configured',
          status: 500,
          provider: 'gemini',
          message: 'Provider not configured.',
        });
      }
      return geminiTimelineProvider;
    default: {
      const exhaustive: never = resolved.provider;
      return exhaustive;
    }
  }
};

export const getTimelineProviderForSettings = (settings: AdminSettings): TimelineProvider =>
  getTimelineProviderForResolved(settings.routing.default);

export const getTimelineProviderFromDrive = async (
  drive: drive_v3.Drive,
  driveFolderId: string,
  ctx?: LogContext,
): Promise<{ provider: TimelineProvider; settings: AdminSettings }> => {
  const { settings } = await readAdminSettingsFromDrive(drive, driveFolderId, ctx);
  const provider = getTimelineProviderForResolved(
    settings.routing.tasks?.summarize ?? settings.routing.default,
  );
  return { provider, settings };
};
