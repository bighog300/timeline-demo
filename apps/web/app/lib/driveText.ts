export const MAX_TEXT_CHARS = 80000;
const TRUNCATION_SUFFIX = '\n\n(truncated)';

type UnsupportedPlaceholderInput = {
  name: string;
  mimeType: string;
  webViewLink?: string;
};

export const truncateText = (value: string, maxChars = MAX_TEXT_CHARS) => {
  if (value.length <= maxChars) {
    return value;
  }

  const sliceLength = Math.max(0, maxChars - TRUNCATION_SUFFIX.length);
  return `${value.slice(0, sliceLength).trimEnd()}${TRUNCATION_SUFFIX}`;
};

export const buildUnsupportedPlaceholder = ({
  name,
  mimeType,
  webViewLink,
}: UnsupportedPlaceholderInput) => {
  const lines = [
    'Unsupported for text extraction in Phase 3A.',
    `File: ${name}`,
    `MIME type: ${mimeType}`,
  ];

  if (webViewLink) {
    lines.push(`Drive link: ${webViewLink}`);
  }

  return lines.join('\n');
};

export const normalizeJsonText = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
};
