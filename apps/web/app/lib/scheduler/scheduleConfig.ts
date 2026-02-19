import { ScheduleConfigSchema, type ScheduleConfig } from '@timeline/shared';

export const SCHEDULE_CONFIG_FILENAME = 'schedule_config.json';

export const createDefaultScheduleConfig = (nowISO = new Date().toISOString()): ScheduleConfig => ({
  version: 1,
  updatedAtISO: nowISO,
  jobs: [],
});

export const normalizeScheduleConfig = (value: unknown, nowISO = new Date().toISOString()): ScheduleConfig => {
  const parsed = ScheduleConfigSchema.safeParse(value);
  if (!parsed.success) {
    return createDefaultScheduleConfig(nowISO);
  }

  return ScheduleConfigSchema.parse({
    ...parsed.data,
    updatedAtISO: nowISO,
  });
};

export const validateScheduleConfigInput = (
  value: unknown,
  nowISO = new Date().toISOString(),
): { config?: ScheduleConfig; error?: string } => {
  const parsed = ScheduleConfigSchema.safeParse(value);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid schedule config payload.' };
  }

  return {
    config: ScheduleConfigSchema.parse({
      ...parsed.data,
      updatedAtISO: nowISO,
    }),
  };
};
