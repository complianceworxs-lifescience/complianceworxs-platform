import { RuntimeAdapter, AdapterResponse } from './adapter.ts';
import { RuntimeConfiguration } from './types.ts';

export const claudeAdapter: RuntimeAdapter = {
  name: 'claude',
  async execute(pkg, filledUserPrompt, config, fetchImpl) {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens, system: pkg.promptSpecification.systemPrompt, messages: [{ role: 'user', content: filledUserPrompt }] }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message ?? 'Claude API error');
    const textContent = data?.content?.[0]?.text ?? '';
    return { rawResponse: data, textContent, model: data?.model ?? config.model, tokens: { input: data?.usage?.input_tokens ?? null, output: data?.usage?.output_tokens ?? null } } satisfies AdapterResponse;
  },
};
