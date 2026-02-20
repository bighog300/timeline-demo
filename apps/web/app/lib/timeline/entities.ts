import type { TimelineArtifact } from './exportBuilder';

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toEntityName = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(value);
    return normalized ? normalized : null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') {
      const normalized = normalizeWhitespace(record.name);
      return normalized ? normalized : null;
    }
  }
  return null;
};

const getStructuredEntityValues = (artifact: TimelineArtifact['artifact']) => {
  const record = artifact as unknown as Record<string, unknown>;
  const direct = Array.isArray(record.entities) ? record.entities : [];
  const structured = record.structured && typeof record.structured === 'object'
    ? ((record.structured as Record<string, unknown>).entities ?? [])
    : [];
  const extracted = record.extracted && typeof record.extracted === 'object'
    ? ((record.extracted as Record<string, unknown>).entities ?? [])
    : [];

  return [direct, structured, extracted].flatMap((value) => (Array.isArray(value) ? value : []));
};

const buildTextHaystack = (artifact: TimelineArtifact['artifact']) => {
  const sourceMetadata = artifact.sourceMetadata as Record<string, unknown> | undefined;
  const metadataValues = sourceMetadata
    ? ['from', 'to', 'subject', 'driveName']
      .map((key) => sourceMetadata[key])
      .filter((value): value is string => typeof value === 'string')
    : [];

  return [
    artifact.summary,
    artifact.title,
    ...(artifact.highlights ?? []),
    ...metadataValues,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ')
    .toLowerCase();
};

export const extractEntityStrings = (artifact: TimelineArtifact): string[] => {
  const structured = getStructuredEntityValues(artifact.artifact)
    .map(toEntityName)
    .filter((value): value is string => Boolean(value));

  const userAnnotationsEntities = (artifact.artifact.userAnnotations?.entities ?? [])
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);

  return Array.from(new Set([...structured, ...userAnnotationsEntities]));
};

export const buildEntityIndex = (artifacts: TimelineArtifact[]) => {
  const counts: Record<string, number> = {};

  artifacts.forEach((artifact) => {
    extractEntityStrings(artifact).forEach((entity) => {
      counts[entity] = (counts[entity] ?? 0) + 1;
    });
  });

  const entities = Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff !== 0) {
      return countDiff;
    }
    return a.localeCompare(b);
  });

  return { entities, counts };
};

export const filterArtifactsByEntity = (artifacts: TimelineArtifact[], entity: string): TimelineArtifact[] => {
  const normalizedEntity = normalizeWhitespace(entity);
  if (!normalizedEntity) {
    return artifacts;
  }
  const normalizedEntityLower = normalizedEntity.toLowerCase();
  const shortEntityRegex = normalizedEntity.length <= 4
    ? new RegExp(`\\b${escapeRegex(normalizedEntity)}\\b`, 'i')
    : null;

  return artifacts.filter((artifact) => {
    const structuredEntities = extractEntityStrings(artifact).map((item) => item.toLowerCase());
    if (structuredEntities.includes(normalizedEntityLower)) {
      return true;
    }

    const haystack = buildTextHaystack(artifact.artifact);
    if (shortEntityRegex) {
      return shortEntityRegex.test(haystack);
    }
    return haystack.includes(normalizedEntityLower);
  });
};

export const normalizeEntityQueryParam = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(value);
    const normalized = normalizeWhitespace(decoded);
    return normalized || null;
  } catch {
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  }
};
