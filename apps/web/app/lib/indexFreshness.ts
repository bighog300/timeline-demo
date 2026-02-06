import type { TimelineIndex } from './indexTypes';

export const DEFAULT_INDEX_MAX_AGE_MINUTES = 10;

export const isIndexFresh = (
  index: TimelineIndex,
  now: Date = new Date(),
  maxAgeMinutes = DEFAULT_INDEX_MAX_AGE_MINUTES,
) => {
  const updated = index.updatedAtISO ? new Date(index.updatedAtISO).getTime() : 0;
  if (!Number.isFinite(updated) || updated <= 0) {
    return false;
  }

  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  return now.getTime() - updated <= maxAgeMs;
};
