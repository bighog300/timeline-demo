import type { CalendarEntry, CalendarEntryLink, CalendarEntryLinkKind } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;

const isCalendarEntryLinkKind = (value: unknown): value is CalendarEntryLinkKind =>
  value === 'summary' || value === 'drive_file' || value === 'gmail_message';

const normalizeLinks = (value: unknown): CalendarEntryLink[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const links = value
    .filter(isRecord)
    .map((link) => {
      if (!isCalendarEntryLinkKind(link.kind) || typeof link.id !== 'string') {
        return null;
      }
      const normalized: CalendarEntryLink = {
        kind: link.kind,
        id: link.id,
      };
      const url = normalizeString(link.url);
      if (url) {
        normalized.url = url;
      }
      return normalized;
    })
    .filter((link): link is CalendarEntryLink => Boolean(link));

  return links.length ? links : undefined;
};

export const isCalendarEntry = (value: unknown): value is CalendarEntry => {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type !== 'calendar_entry') {
    return false;
  }

  if (value.source !== 'user' && value.source !== 'derived') {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.startISO === 'string' &&
    typeof value.endISO === 'string' &&
    typeof value.allDay === 'boolean' &&
    (value.location === undefined || typeof value.location === 'string') &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.tags === undefined || Array.isArray(value.tags)) &&
    (value.links === undefined || Array.isArray(value.links)) &&
    typeof value.createdAtISO === 'string' &&
    typeof value.updatedAtISO === 'string'
  );
};

export const normalizeCalendarEntry = (entry: CalendarEntry): CalendarEntry => ({
  ...entry,
  location: normalizeString(entry.location),
  notes: normalizeString(entry.notes),
  tags: normalizeStringArray(entry.tags),
  links: normalizeLinks(entry.links),
});
