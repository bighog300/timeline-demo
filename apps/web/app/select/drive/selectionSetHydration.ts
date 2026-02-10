import type { DriveSelectionSet } from '../../lib/selectionSets';

export type HydratedDriveQueryControls = {
  nameContains: string;
  mimeGroup: DriveSelectionSet['query']['mimeGroup'];
  modifiedPreset: DriveSelectionSet['query']['modifiedPreset'];
  modifiedAfter: string;
  inFolderId: string;
  ownerEmail: string;
};

const toDateInputValue = (isoValue: string | null): string => {
  if (!isoValue) {
    return '';
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
};

export const hydrateDriveQueryControls = (selectionSet: DriveSelectionSet): HydratedDriveQueryControls => ({
  nameContains: selectionSet.query.nameContains,
  mimeGroup: selectionSet.query.mimeGroup,
  modifiedPreset: selectionSet.query.modifiedPreset,
  modifiedAfter: toDateInputValue(selectionSet.query.modifiedAfter),
  inFolderId: selectionSet.query.inFolderId ?? '',
  ownerEmail: selectionSet.query.ownerEmail ?? '',
});
