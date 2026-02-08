import type { LLMProviderName, LLMRequest, LLMResponse } from './types';
import { callGemini } from './providers/gemini';
import { callOpenAI } from './providers/openai';
import { callStub } from './providers/stub';

export const callLLM = async (provider: LLMProviderName, req: LLMRequest): Promise<LLMResponse> => {
  switch (provider) {
    case 'stub':
      return callStub(req);
    case 'openai':
      return callOpenAI(req);
    case 'gemini':
      return callGemini(req);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${exhaustive}`);
    }
  }
};
