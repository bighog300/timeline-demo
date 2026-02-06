const ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

const replyMarkers = [
  /^On .+ wrote:$/i,
  /^From:\s/i,
  /^Sent:\s/i,
  /^-----Original Message-----/i,
];

const signatureMarkers = [/^--\s*$/, /^sent from my/i];

export const decodeHtmlEntities = (value: string) =>
  value.replace(/(&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&#x27;)/gi, (match) => {
    const key = match.toLowerCase();
    return ENTITY_MAP[key] ?? match;
  });

export const stripHtml = (value: string) => {
  const withoutScripts = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(stripped);
};

export const normalizeWhitespace = (value: string) => {
  const lines = value.replace(/\r\n/g, '\n').replace(/\t/g, ' ').split('\n');
  const cleaned: string[] = [];

  lines.forEach((line) => {
    const collapsed = line.replace(/[ \t]+/g, ' ').trimEnd();
    if (collapsed === '' && cleaned[cleaned.length - 1] === '') {
      return;
    }
    cleaned.push(collapsed);
  });

  while (cleaned[0] === '') {
    cleaned.shift();
  }
  while (cleaned[cleaned.length - 1] === '') {
    cleaned.pop();
  }

  return cleaned.join('\n').trim();
};

export const trimQuotedReplies = (value: string) => {
  const original = value.trim();
  if (!original) {
    return original;
  }

  let lines = original.replace(/\r\n/g, '\n').split('\n');
  const markerIndex = lines.findIndex((line) =>
    replyMarkers.some((pattern) => pattern.test(line.trim())),
  );
  if (markerIndex > 0) {
    lines = lines.slice(0, markerIndex);
  }

  const signatureIndex = lines.findIndex((line) =>
    signatureMarkers.some((pattern) => pattern.test(line.trim())),
  );
  if (signatureIndex > 0) {
    lines = lines.slice(0, signatureIndex);
  }

  const quoteLines = lines.filter((line) => line.trim().startsWith('>'));
  if (quoteLines.length >= 4 && quoteLines.length >= Math.ceil(lines.length / 3)) {
    lines = lines.filter((line) => !line.trim().startsWith('>'));
  }

  const candidate = lines.join('\n').trim();
  if (candidate.length < 20 && original.length < 200) {
    return original;
  }

  return candidate || original;
};
