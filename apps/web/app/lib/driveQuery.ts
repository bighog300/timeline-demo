export type DriveMimeGroup = 'any' | 'pdf' | 'doc' | 'sheet' | 'slide' | 'image' | 'folder';

export type DriveModifiedPreset = '7d' | '30d' | '90d' | 'custom';

export type DriveQueryInput = {
  nameContains: string;
  mimeGroup: DriveMimeGroup;
  modifiedPreset: DriveModifiedPreset;
  modifiedAfter: string | null;
  inFolderId: string | null;
  ownerEmail: string | null;
  starred?: boolean;
};

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');

const escapeLiteral = (value: string) => collapseWhitespace(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const literal = (value: string) => `'${escapeLiteral(value)}'`;

const daysAgoIso = (days: number) => {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString();
};

const normalizeOwnerEmail = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const email = collapseWhitespace(value).toLowerCase();
  return email || null;
};

const normalizeDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const mimeGroupClause = (mimeGroup: DriveMimeGroup): string | null => {
  if (mimeGroup === 'pdf') {
    return "mimeType='application/pdf'";
  }

  if (mimeGroup === 'doc') {
    return "(mimeType='application/vnd.google-apps.document' or mimeType='application/msword' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')";
  }

  if (mimeGroup === 'sheet') {
    return "(mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.ms-excel' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')";
  }

  if (mimeGroup === 'slide') {
    return "(mimeType='application/vnd.google-apps.presentation' or mimeType='application/vnd.ms-powerpoint' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation')";
  }

  if (mimeGroup === 'image') {
    return "mimeType contains 'image/'";
  }

  if (mimeGroup === 'folder') {
    return "mimeType='application/vnd.google-apps.folder'";
  }

  return null;
};

const modifiedTimeClause = (modifiedPreset: DriveModifiedPreset, modifiedAfter: string | null) => {
  if (modifiedPreset === 'custom') {
    const customDate = normalizeDate(modifiedAfter);
    return customDate ? `modifiedTime > ${literal(customDate)}` : null;
  }

  if (modifiedPreset === '7d') {
    return `modifiedTime > ${literal(daysAgoIso(7))}`;
  }

  if (modifiedPreset === '30d') {
    return `modifiedTime > ${literal(daysAgoIso(30))}`;
  }

  return `modifiedTime > ${literal(daysAgoIso(90))}`;
};

export const buildDriveQuery = ({
  nameContains,
  mimeGroup,
  modifiedPreset,
  modifiedAfter,
  inFolderId,
  ownerEmail,
  starred,
}: DriveQueryInput): string => {
  const clauses: string[] = ['trashed=false'];

  const name = collapseWhitespace(nameContains);
  if (name) {
    clauses.push(`name contains ${literal(name)}`);
  }

  const mimeClause = mimeGroupClause(mimeGroup);
  if (mimeClause) {
    clauses.push(mimeClause);
  }

  const modifiedClause = modifiedTimeClause(modifiedPreset, modifiedAfter);
  if (modifiedClause) {
    clauses.push(modifiedClause);
  }

  const folderId = inFolderId ? collapseWhitespace(inFolderId) : '';
  if (folderId) {
    clauses.push(`${literal(folderId)} in parents`);
  }

  const owner = normalizeOwnerEmail(ownerEmail);
  if (owner) {
    clauses.push(`${literal(owner)} in owners`);
  }

  if (typeof starred === 'boolean') {
    clauses.push(`starred=${starred}`);
  }

  return clauses.join(' and ');
};
