import type { LLMRequest, LLMResponse } from '../types';

const buildAdvisorStubReply = (contextSourceCount: number) =>
  [
    '## Timeline summary',
    `- Reviewed ${contextSourceCount} source summaries from provided context [1].`,
    '',
    '## What stands out',
    '- The sequence may indicate a recurring communication pattern worth deeper review [1].',
    '',
    '## Legal considerations (general information)',
    '- Depending on full facts, contract, employment, confidentiality, or safeguarding issues may be relevant [1].',
    '- Not legal advice.',
    '',
    '## Psychological and interpersonal signals (non-clinical)',
    '- The messages may reflect escalation or boundary-setting dynamics, though evidence is limited [1].',
    '- Not a diagnosis.',
    '',
    '## Questions to clarify',
    '- Which date range has the most disputed facts?',
    '- Which source should be opened next to confirm wording?',
    '',
    '## Suggested next steps',
    '- Open originals for SOURCE 1 and SOURCE 2.',
    '- Summarize emails from a key sender across the relevant dates.',
    '- Consult a solicitor for jurisdiction-specific advice.',
  ].join('\n');

export const callStub = async (req: LLMRequest): Promise<LLMResponse> => {
  const lastUserMessage =
    [...req.messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.content.trim() || 'Hello';
  const contextItemCount =
    (req as LLMRequest & { context?: { items?: unknown[] } }).context?.items?.length || 0;

  if (req.systemPrompt.includes('## Timeline summary')) {
    return {
      text: buildAdvisorStubReply(contextItemCount),
    };
  }

  return {
    text: `[stub:${req.model}] Received '${lastUserMessage}'. Found ${contextItemCount} context items.`,
  };
};
