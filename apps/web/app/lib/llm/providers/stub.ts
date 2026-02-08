import type { LLMRequest, LLMResponse } from '../types';

export const callStub = async (req: LLMRequest): Promise<LLMResponse> => {
  const messageCount = req.messages.length;
  const systemHint = req.systemPrompt ? req.systemPrompt.slice(0, 40) : 'no-system-prompt';
  return {
    text: `[stub:${req.model}] ${systemHint} (${messageCount} messages)`,
  };
};
