import type { Model } from "@openai/agents";

/**
 * Wraps a model, keeping the wrapped model's prototype and own properties. The SDK's sandbox
 * capability machinery reads the model instance's constructor name to choose its transports: a
 * name containing "ChatCompletions" selects the plain-function apply_patch tool, text tool
 * outputs and no Responses-only compaction settings, and any other name selects the hosted,
 * Responses-only tools. A wrapper that flattens the model into a plain object erases that
 * identity — the constructor becomes `Object` — and silently re-enables hosted tools a Chat
 * Completions endpoint refuses, so every layer that wraps a model wraps it through here instead.
 * Overrides replace the named methods; everything else, including methods the wrapped model
 * inherits from its prototype, keeps working against the wrapper.
 */
export const modelWithOverrides = (
  model: Model,
  overrides: Partial<Pick<Model, "getResponse" | "getStreamedResponse">>,
): Model => {
  const wrapped = Object.create(Object.getPrototypeOf(model)) as Model;
  return Object.assign(wrapped, model, overrides);
};
