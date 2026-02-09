import type { LLMRequest, LLMResponse } from '../types';

export const callStub = async (req: LLMRequest): Promise<LLMResponse> => {
  const lastUserMessage =
    [...req.messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.content.trim() || 'Hello';
  const contextItemCount =
    (req as LLMRequest & { context?: { items?: unknown[] } }).context?.items?.length || 0;
  return {
    text: `[stub:${req.model}] Received '${lastUserMessage}'. Found ${contextItemCount} context items.`,
  };
};
