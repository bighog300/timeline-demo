import { SourceMetadataSchema, SummaryArtifactSchema, type SummaryArtifact } from '@timeline/shared';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;


const normalizeSuggestedActions = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const action = item as Record<string, unknown>;
      return {
        id: normalizeString(action.id),
        type: normalizeString(action.type),
        text: normalizeString(action.text) ?? '',
        dueDateISO: action.dueDateISO === null ? null : normalizeString(action.dueDateISO),
        confidence: typeof action.confidence === 'number' ? action.confidence : action.confidence === null ? null : undefined,
        status: normalizeString(action.status),
        createdAtISO: normalizeString(action.createdAtISO),
        updatedAtISO: normalizeString(action.updatedAtISO),
      };
    });
};


const normalizeEntities = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          name: normalizeString((item as { name?: unknown }).name) ?? '',
          type: normalizeString((item as { type?: unknown }).type),
        }))
        .filter((item) => item.name)
    : undefined;

const normalizeStructuredRows = (value: unknown, kind: 'decision' | 'openLoop' | 'risk') =>
  Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const row = item as Record<string, unknown>;
          if (kind === 'decision') {
            return {
              text: normalizeString(row.text) ?? '',
              dateISO: row.dateISO === null ? null : normalizeString(row.dateISO),
              owner: row.owner === null ? null : normalizeString(row.owner),
              confidence: typeof row.confidence === 'number' ? row.confidence : row.confidence === null ? null : undefined,
            };
          }
          if (kind === 'openLoop') {
            return {
              text: normalizeString(row.text) ?? '',
              owner: row.owner === null ? null : normalizeString(row.owner),
              dueDateISO: row.dueDateISO === null ? null : normalizeString(row.dueDateISO),
              status: normalizeString(row.status),
              confidence: typeof row.confidence === 'number' ? row.confidence : row.confidence === null ? null : undefined,
            };
          }
          return {
            text: normalizeString(row.text) ?? '',
            severity: normalizeString(row.severity),
            likelihood: normalizeString(row.likelihood),
            owner: row.owner === null ? null : normalizeString(row.owner),
            mitigation: row.mitigation === null ? null : normalizeString(row.mitigation),
            confidence: typeof row.confidence === 'number' ? row.confidence : row.confidence === null ? null : undefined,
          };
        })
        .filter((item) => item.text)
    : undefined;

const normalizeSourceMetadata = (value: unknown) => {
  if (!isRecord(value)) {
    return undefined;
  }

  const metadata = {
    from: normalizeString(value.from),
    to: normalizeString(value.to),
    subject: normalizeString(value.subject),
    dateISO: normalizeString(value.dateISO),
    threadId: normalizeString(value.threadId),
    labels: normalizeStringArray(value.labels),
    mimeType: normalizeString(value.mimeType),
    driveName: normalizeString(value.driveName),
    driveModifiedTime: normalizeString(value.driveModifiedTime),
    driveWebViewLink: normalizeString(value.driveWebViewLink),
  };

  const parsed = SourceMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : undefined;
};

const coerceArtifact = (value: unknown): SummaryArtifact | null => {
  if (!isRecord(value)) {
    return null;
  }

  const parsed = SummaryArtifactSchema.safeParse({
    artifactId: value.artifactId,
    source: value.source,
    sourceId: value.sourceId,
    title: value.title,
    createdAtISO: value.createdAtISO,
    summary: value.summary,
    contentDateISO: normalizeString(value.contentDateISO),
    highlights: Array.isArray(value.highlights)
      ? value.highlights.filter((item) => typeof item === 'string')
      : [],
    evidence: Array.isArray(value.evidence)
      ? value.evidence
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            sourceId: normalizeString((item as { sourceId?: unknown }).sourceId),
            excerpt: normalizeString((item as { excerpt?: unknown }).excerpt) ?? '',
          }))
          .filter((item) => item.excerpt)
      : undefined,
    dateConfidence: typeof value.dateConfidence === 'number' ? value.dateConfidence : undefined,
    sourceMetadata: normalizeSourceMetadata(value.sourceMetadata),
    sourcePreview: normalizeString(value.sourcePreview),
    suggestedActions: normalizeSuggestedActions(value.suggestedActions),
    entities: normalizeEntities(value.entities),
    decisions: normalizeStructuredRows(value.decisions, 'decision'),
    openLoops: normalizeStructuredRows(value.openLoops, 'openLoop'),
    risks: normalizeStructuredRows(value.risks, 'risk'),
    participants: normalizeStringArray(value.participants),
    tags: normalizeStringArray(value.tags),
    topics: normalizeStringArray(value.topics),
    driveFolderId: typeof value.driveFolderId === 'string' ? value.driveFolderId : '',
    driveFileId: typeof value.driveFileId === 'string' ? value.driveFileId : '',
    driveWebViewLink: normalizeString(value.driveWebViewLink),
    model: typeof value.model === 'string' && value.model ? value.model : 'unknown',
    version: typeof value.version === 'number' && value.version > 0 ? value.version : 1,
  });

  return parsed.success ? parsed.data : null;
};

export const isSummaryArtifact = (value: unknown): value is SummaryArtifact => coerceArtifact(value) !== null;

export const normalizeArtifact = (artifact: SummaryArtifact): SummaryArtifact => {
  const normalized = coerceArtifact(artifact);
  if (normalized) {
    return { ...artifact, ...normalized };
  }

  return {
    ...artifact,
    highlights: [],
    model: 'unknown',
    version: 1,
    driveFolderId: '',
    driveFileId: '',
  };
};
