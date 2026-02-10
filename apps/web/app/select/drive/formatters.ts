export type FileBadgeKind = 'pdf' | 'doc' | 'sheet' | 'slide' | 'image' | 'folder' | 'other';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const formatBytes = (bytes?: number): string => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) {
    return '—';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};

export const formatRelativeTime = (iso?: string | null): string => {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const delta = Date.now() - date.getTime();
  if (delta < MINUTE_MS) {
    return 'just now';
  }

  if (delta < HOUR_MS) {
    const minutes = Math.floor(delta / MINUTE_MS);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  if (delta < DAY_MS) {
    const hours = Math.floor(delta / HOUR_MS);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(delta / DAY_MS);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export const fileTypeBadge = (mimeType: string): { label: string; kind: FileBadgeKind } => {
  if (mimeType === 'application/pdf') {
    return { label: 'PDF', kind: 'pdf' };
  }

  if (mimeType === 'application/vnd.google-apps.document') {
    return { label: 'Doc', kind: 'doc' };
  }

  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return { label: 'Sheet', kind: 'sheet' };
  }

  if (mimeType === 'application/vnd.google-apps.presentation') {
    return { label: 'Slide', kind: 'slide' };
  }

  if (mimeType.startsWith('image/')) {
    return { label: 'Image', kind: 'image' };
  }

  if (mimeType === 'application/vnd.google-apps.folder') {
    return { label: 'Folder', kind: 'folder' };
  }

  return { label: 'Other', kind: 'other' };
};

export const safeCopyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
};
