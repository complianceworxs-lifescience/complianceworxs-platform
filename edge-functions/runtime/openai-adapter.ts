import { RuntimeAdapter, AdapterResponse } from './adapter.ts';
import { RuntimeConfiguration } from './types.ts';

export const openaiAdapter: RuntimeAdapter = {
  name: 'gpt',
  async execute(pkg, filledUserPrompt, config, fetchImpl) {
    const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens, messages: [{ role: 'developer', content: pkg.promptSpecification.systemPrompt }, { role: 'user', content: filledUserPrompt }] }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message ?? 'OpenAI API error');
    const textContent = data?.choices?.[0]?.message?.content ?? '';
    return { rawResponse: data, textContent, model: data?.model ?? config.model, tokens: { input: data?.usage?.prompt_tokens ?? null, output: data?.usage?.completion_tokens ?? null } } satisfies AdapterResponse;
  },
};
