export type LLMProviderName = 'stub' | 'openai' | 'gemini';

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LLMRequest = {
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  temperature?: number;
};

export type LLMUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LLMResponse = {
  text: string;
  usage?: LLMUsage;
};
