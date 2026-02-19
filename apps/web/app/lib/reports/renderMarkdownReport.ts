import type { StructuredQueryResponse } from '@timeline/shared';

const heading = (value: string, depth = 2) => `${'#'.repeat(depth)} ${value}`;

export const renderMarkdownReport = ({
  title,
  generatedAtISO,
  query,
  results,
  includeCitations,
  synthesisContent,
}: {
  title: string;
  generatedAtISO: string;
  query: StructuredQueryResponse['query'];
  results: StructuredQueryResponse['results'];
  includeCitations: boolean;
  synthesisContent?: string;
}) => {
  const entityCounts = new Map<string, number>();
  const decisions = results.flatMap((row) => row.matches.decisions ?? []);
  const loops = results.flatMap((row) => row.matches.openLoops ?? []);
  const risks = results.flatMap((row) => row.matches.risks ?? []);

  results.forEach((row) => (row.entities ?? []).forEach((entity) => {
    entityCounts.set(entity.name, (entityCounts.get(entity.name) ?? 0) + 1);
  }));

  const topEntities = Array.from(entityCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const highRisks = risks.filter((risk) => risk.severity === 'high');

  const lines: string[] = [
    `# ${title}`,
    '',
    `Generated: ${generatedAtISO}`,
    '',
    heading('Query Summary'),
    '',
    '```json',
    JSON.stringify(query, null, 2),
    '```',
    '',
  ];

  if (synthesisContent) {
    lines.push(heading('Synthesis'));
    lines.push('');
    lines.push(synthesisContent);
    lines.push('');
  }

  lines.push(heading('Top Entities'));
  lines.push('');
  topEntities.forEach(([name, count]) => lines.push(`- ${name} (${count})`));
  lines.push('');

  lines.push(heading('Decisions'));
  lines.push('');
  decisions.forEach((item) => lines.push(`- ${item.text}${item.dateISO ? ` — ${item.dateISO}` : ''}`));
  lines.push('');

  lines.push(heading('Open Loops (Open)'));
  lines.push('');
  loops.filter((loop) => (loop.status ?? 'open') === 'open').forEach((item) => lines.push(`- ${item.text}`));
  lines.push('');

  lines.push(heading('Open Loops (Closed)'));
  lines.push('');
  loops.filter((loop) => (loop.status ?? 'open') === 'closed').forEach((item) => lines.push(`- ${item.text}`));
  lines.push('');

  lines.push(heading('High Risks'));
  lines.push('');
  highRisks.forEach((item) => lines.push(`- ${item.text}`));
  lines.push('');

  if (includeCitations) {
    lines.push(heading('Citations'));
    lines.push('');
    results.forEach((row) => {
      lines.push(`- ${row.artifactId}${row.title ? ` — ${row.title}` : ''}${row.contentDateISO ? ` (${row.contentDateISO})` : ''}`);
    });
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
};
