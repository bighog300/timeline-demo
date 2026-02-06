import type { TimelineIndex } from './indexTypes';

type DriveListingFile = {
  id?: string | null;
  name?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
};

const SUMMARY_SUFFIX = ' - Summary.json';
const SELECTION_SUFFIX = ' - Selection.json';

const stripSuffix = (name: string, suffix: string) => {
  const lowered = name.toLowerCase();
  const loweredSuffix = suffix.toLowerCase();
  if (lowered.endsWith(loweredSuffix)) {
    return name.slice(0, name.length - suffix.length).trim() || 'Untitled';
  }
  return name.trim() || 'Untitled';
};

const sortByUpdated = (a?: string, b?: string) => {
  const aTime = a ? new Date(a).getTime() : 0;
  const bTime = b ? new Date(b).getTime() : 0;
  return bTime - aTime;
};

export const buildIndexFromDriveListing = (listing: DriveListingFile[]): TimelineIndex => {
  const summaries = listing
    .filter((file) => Boolean(file.id) && Boolean(file.name))
    .filter((file) => file.name?.toLowerCase().endsWith(SUMMARY_SUFFIX.toLowerCase()))
    .map((file) => ({
      driveFileId: file.id ?? '',
      title: stripSuffix(file.name ?? 'Untitled Summary', SUMMARY_SUFFIX),
      source: 'drive' as const,
      sourceId: file.id ?? '',
      updatedAtISO: file.modifiedTime ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
    }))
    .sort((a, b) => sortByUpdated(a.updatedAtISO, b.updatedAtISO));

  const selectionSets = listing
    .filter((file) => Boolean(file.id) && Boolean(file.name))
    .filter((file) => file.name?.toLowerCase().endsWith(SELECTION_SUFFIX.toLowerCase()))
    .map((file) => ({
      driveFileId: file.id ?? '',
      name: stripSuffix(file.name ?? 'Untitled Selection', SELECTION_SUFFIX),
      updatedAtISO: file.modifiedTime ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
    }))
    .sort((a, b) => sortByUpdated(a.updatedAtISO, b.updatedAtISO));

  return {
    version: 1,
    updatedAtISO: new Date().toISOString(),
    driveFolderId: '',
    indexFileId: '',
    summaries,
    selectionSets,
    stats: {
      totalSummaries: summaries.length,
      totalSelectionSets: selectionSets.length,
    },
  };
};
