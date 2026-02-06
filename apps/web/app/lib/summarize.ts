type SummarizeInput = {
  title: string;
  text: string;
};

type SummarizeOutput = {
  summary: string;
  highlights: string[];
};

const normalizeText = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();

const splitSentences = (value: string) =>
  value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const pickHighlights = (value: string) => {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(lines));
  return unique.slice(0, 5);
};

export const summarizeDeterministic = ({ title, text }: SummarizeInput): SummarizeOutput => {
  const normalized = normalizeText(`${title}\n${text}`.trim());
  if (!normalized) {
    return { summary: 'No content available to summarize.', highlights: [] };
  }

  const sentences = splitSentences(normalized);
  const summary = sentences.slice(0, 3).join(' ').slice(0, 400).trim() || normalized.slice(0, 240);
  const highlights = pickHighlights(normalized.replace(title, '').trim());

  return {
    summary,
    highlights,
  };
};
