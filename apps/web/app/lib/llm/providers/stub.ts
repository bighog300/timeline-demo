import type { LLMRequest, LLMResponse } from '../types';

const countSourcesInMessages = (req: LLMRequest) => {
  const contextText = req.messages.map((message) => message.content).join('\n');
  const sourceMatches = contextText.match(/SOURCE\s+\d+/g);
  return sourceMatches?.length ?? 0;
};

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

const buildSynthesisStubReply = (contextSourceCount: number) =>
  [
    '## Synthesized timeline',
    `- Date/Time: 2024-01-02 | Actor(s): Project Lead | Action: Drafted launch plan. | Evidence: [1] | Relevance/Impact: Established timeline baseline [1].`,
    '- Date/Time: date not specified | Actor(s): Team members | Action: Follow-up communications continued. | Evidence: [1] | Relevance/Impact: Indicates ongoing coordination [1].',
    `- Date/Time: Unknown | Actor(s): Records reviewed | Action: Synthesized ${contextSourceCount} SOURCES. | Evidence: [1] | Relevance/Impact: Provides cross-document overview [1].`,
    '',
    '## Key actors and entities',
    '- Project Lead: central coordinator for documented actions [1].',
    '- Team members: contributors appearing in follow-up summaries [1].',
    '',
    '## Themes and turning points',
    '- Theme: coordination cadence across documents [1].',
    '- Turning point: move from planning to follow-up actions [1].',
    '',
    '## Legal considerations (general information)',
    '- Depending on fuller facts, contractual or employment obligations could be relevant [1].',
    '- Not legal advice.',
    '',
    '## Psychological and interpersonal signals (non-clinical)',
    '- The summaries may show pressure and boundary-management dynamics over time [1].',
    '- Not a diagnosis.',
    '',
    '## Contradictions and uncertainties',
    '- Some entries have missing timestamps (“date not specified”), limiting exact sequencing [1].',
    '',
    '## Questions to clarify',
    '- Which interaction marks the key escalation point?',
    '- Which dates require exact verification from originals?',
    '',
    '## Suggested next steps',
    '- Open originals for SOURCE 1 and SOURCE 2 to validate exact wording.',
    '- Summarize these additional emails/files for the same date range.',
    '- Review contradictions around disputed dates or participants.',
  ].join('\n');

export const callStub = async (req: LLMRequest): Promise<LLMResponse> => {
  const lastUserMessage =
    [...req.messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.content.trim() || 'Hello';

  const contextItemCount =
    (req as LLMRequest & { context?: { items?: unknown[] } }).context?.items?.length ||
    countSourcesInMessages(req);

  if (req.systemPrompt.includes('## Synthesized timeline')) {
    return {
      text: buildSynthesisStubReply(contextItemCount),
    };
  }

  if (req.systemPrompt.includes('## Timeline summary')) {
    return {
      text: buildAdvisorStubReply(contextItemCount),
    };
  }

  return {
    text: `[stub:${req.model}] Received '${lastUserMessage}'. Found ${contextItemCount} context items.`,
  };
};
