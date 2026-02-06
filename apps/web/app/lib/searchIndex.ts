import type { SelectionSet, SummaryArtifact } from './types';

export const normalizeQuery = (q: string) => q.toLowerCase().trim().replace(/\s+/g, ' ');

export const findSnippet = (text: string | undefined, q: string) => {
  if (!text || !q) {
    return '';
  }

  const lowered = text.toLowerCase();
  const index = lowered.indexOf(q);
  if (index < 0) {
    return '';
  }

  const context = 40;
  const start = Math.max(0, index - context);
  const end = Math.min(text.length, index + q.length + context);
  let snippet = text.slice(start, end).trim();

  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < text.length) {
    snippet = `${snippet}…`;
  }

  return snippet;
};

const fieldMatches = (text: string | undefined, query: string) => {
  if (!text || !query) {
    return false;
  }

  return text.toLowerCase().includes(query);
};

export const matchSummaryArtifact = (artifact: SummaryArtifact, q: string) => {
  const query = normalizeQuery(q);
  const fields: string[] = [];
  let snippet = '';

  if (!query) {
    return { matched: false, snippet, fields };
  }

  if (fieldMatches(artifact.title, query)) {
    fields.push('title');
    snippet = snippet || findSnippet(artifact.title, query);
  }

  if (fieldMatches(artifact.summary, query)) {
    fields.push('summary');
    snippet = snippet || findSnippet(artifact.summary, query);
  }

  const highlightsText = Array.isArray(artifact.highlights)
    ? artifact.highlights.join(' ')
    : undefined;
  if (fieldMatches(highlightsText, query)) {
    fields.push('highlights');
    snippet = snippet || findSnippet(highlightsText, query);
  }

  const metadataText = artifact.sourceMetadata
    ? [
        artifact.sourceMetadata.from,
        artifact.sourceMetadata.to,
        artifact.sourceMetadata.subject,
        artifact.sourceMetadata.labels?.join(' '),
        artifact.sourceMetadata.driveName,
        artifact.sourceMetadata.mimeType,
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  if (fieldMatches(metadataText, query)) {
    fields.push('sourceMetadata');
    snippet = snippet || findSnippet(metadataText, query);
  }

  return { matched: fields.length > 0, snippet, fields };
};

export const matchSelectionSet = (set: SelectionSet, q: string) => {
  const query = normalizeQuery(q);
  const fields: string[] = [];
  let snippet = '';

  if (!query) {
    return { matched: false, snippet, fields };
  }

  if (fieldMatches(set.name, query)) {
    fields.push('name');
    snippet = snippet || findSnippet(set.name, query);
  }

  if (fieldMatches(set.notes, query)) {
    fields.push('notes');
    snippet = snippet || findSnippet(set.notes, query);
  }

  const itemsText = Array.isArray(set.items)
    ? set.items
        .map((item) => [item.title, item.id].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' ')
    : undefined;

  if (fieldMatches(itemsText, query)) {
    fields.push('items');
    snippet = snippet || findSnippet(itemsText, query);
  }

  return { matched: fields.length > 0, snippet, fields };
};
