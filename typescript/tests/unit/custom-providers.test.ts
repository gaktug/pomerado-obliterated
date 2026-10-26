import { withTrace } from "@openai/agents";
import { Effect } from "effect";
import { expect, it } from "vitest";
import type { ModelProvider, ModelRequest, ModelResponse } from "@openai/agents";
import { lunaModel, solModel } from "../../src/models/models.js";
import {
  chatCompatibleModel,
  customModelProviders,
  modelProviderSetup,
  type CustomModelProviderConfig,
} from "../../src/models/custom-providers.js";
import { createPomerado, withConfiguredModelProviders } from "../../src/standalone/pomerado.js";
import type { PomeradoOptions } from "../../src/standalone/contracts.js";

/** A synthetic OpenAI-compatible Chat Completions answer; no request leaves the process. */
const chatCompletion = () =>
  new Response(
    JSON.stringify({
      id: "chatcmpl_synth",
      object: "chat.completion",
      created: 1,
      model: "vendor-model",
      choices: [
        { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { "content-type": "application/json" } },
  );

/** Captures every request body the provider would send, answering each from `answer`. */
const wire = (answer: () => Response = chatCompletion) => {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  return {
    bodies,
    urls,
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(url));
      bodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >);
      return answer();
    },
  };
};

const baseURL = "https://vendor.example.test/v1";
const apiKeyEnv = "VENDOR_API_KEY";
const configured = (models: Partial<CustomModelProviderConfig> = {}): CustomModelProviderConfig => ({
  baseURL,
  apiKeyEnv,
  protocol: "chat_completions",
  ...models,
});

/** A request as the host's agents build it, with only the fields this test varies. */
const request = (over: Partial<ModelRequest> = {}): ModelRequest =>
  ({
    input: [{ role: "user", type: "message", content: "Go" }],
    outputType: "text",
    modelSettings: {},
    tracing: false,
    ...over,
  }) as ModelRequest;

/** A function tool as a request carries it. */
const tool = (name: string) =>
  ({ type: "function", name, description: name, parameters: {} }) as unknown as NonNullable<
    ModelRequest["tools"]
  >[number];

/** A model that records the requests it received and answers one synthetic response. */
const recordingModel = () => {
  const requests: ModelRequest[] = [];
  const response: ModelResponse = { usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 } as never, output: [] };
  const model = {
    getResponse: async (sent: ModelRequest) => {
      requests.push(sent);
      return response;
    },
    getStreamedResponse: () => {
      throw new Error("No streamed request in this test");
    },
  };
  return { requests, response, model };
};

it("leaves the default OpenAI provider in place with no configuration", () => {
  expect(modelProviderSetup({})).toEqual({ provider: "default" });
  expect(
    modelProviderSetup({ POMERADO_MODEL_API_KEY_ENV: apiKeyEnv, VENDOR_API_KEY: "synthetic" }),
  ).toEqual({ provider: "default" });
});

it("reads a custom provider from the environment and prefers chat completions", () => {
  expect(
    modelProviderSetup({
      POMERADO_MODEL_BASE_URL: baseURL,
      POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
      VENDOR_API_KEY: "synthetic",
    }),
  ).toEqual({ provider: "custom", config: configured() });
  expect(
    modelProviderSetup({
      POMERADO_MODEL_BASE_URL: baseURL,
      POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
      POMERADO_MODEL_PROTOCOL: "chat_completions",
      VENDOR_API_KEY: "synthetic",
    }),
  ).toEqual({ provider: "custom", config: configured() });
});

it("selects the responses protocol only when named", () => {
  expect(
    modelProviderSetup({
      POMERADO_MODEL_BASE_URL: baseURL,
      POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
      POMERADO_MODEL_PROTOCOL: "responses",
      VENDOR_API_KEY: "synthetic",
    }),
  ).toEqual({ provider: "custom", config: configured({ protocol: "responses" }) });
});

it("reads each role's model id independently", () => {
  expect(
    modelProviderSetup({
      POMERADO_MODEL_BASE_URL: baseURL,
      POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
      POMERADO_MINTER_MODEL: "vendor-minter",
      POMERADO_GUARDIAN_MODEL: "vendor-guardian",
      POMERADO_OUTCOME_REVIEWER_MODEL: "vendor-reviewer",
      VENDOR_API_KEY: "synthetic",
    }),
  ).toEqual({
    provider: "custom",
    config: configured({
      minterModel: "vendor-minter",
      guardianModel: "vendor-guardian",
      outcomeReviewerModel: "vendor-reviewer",
    }),
  });
});

it("rejects an unknown protocol", () => {
  const setup = modelProviderSetup({
    POMERADO_MODEL_BASE_URL: baseURL,
    POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
    POMERADO_MODEL_PROTOCOL: "grpc",
    VENDOR_API_KEY: "synthetic",
  });
  expect(setup).toEqual({ provider: "invalid", reason: expect.stringContaining("POMERADO_MODEL_PROTOCOL") });
});

it("rejects a custom provider that names no key variable", () => {
  const setup = modelProviderSetup({ POMERADO_MODEL_BASE_URL: baseURL });
  expect(setup).toEqual({
    provider: "invalid",
    reason: expect.stringContaining("POMERADO_MODEL_API_KEY_ENV"),
  });
});

it("rejects a custom provider whose key variable holds nothing, without naming a key", () => {
  const setup = modelProviderSetup({
    POMERADO_MODEL_BASE_URL: baseURL,
    POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
  });
  expect(setup).toEqual({
    provider: "invalid",
    reason: expect.stringContaining(apiKeyEnv),
  });
  if (setup.provider === "invalid") expect(setup.reason).not.toContain("synthetic");
});

it("sends each role's configured model id over chat completions", async () => {
  const { bodies, urls, fetch } = wire();
  const providers = customModelProviders(
    configured({
      minterModel: "vendor-minter",
      guardianModel: "vendor-guardian",
      outcomeReviewerModel: "vendor-reviewer",
    }),
    "synthetic",
    { fetch: fetch as typeof fetch },
  );
  await withTrace("custom providers", async () => {
    await (await providers.minter.getModel(solModel)).getResponse(request());
    await (await providers.guardian.getModel(lunaModel)).getResponse(request());
    await (await providers.outcomeReviewer.getModel(lunaModel)).getResponse(request());
  });
  expect(urls).toEqual([
    `${baseURL}/chat/completions`,
    `${baseURL}/chat/completions`,
    `${baseURL}/chat/completions`,
  ]);
  expect(bodies.map((body) => body["model"])).toEqual([
    "vendor-minter",
    "vendor-guardian",
    "vendor-reviewer",
  ]);
});

it("sends the built-in model id a role did not override", async () => {
  const { bodies, fetch } = wire();
  const providers = customModelProviders(configured(), "synthetic", { fetch: fetch as typeof fetch });
  await withTrace("custom providers", async () => {
    await (await providers.minter.getModel(solModel)).getResponse(request());
  });
  expect(bodies[0]?.["model"]).toBe(solModel);
});

it("sends a request a compatibility endpoint accepts", async () => {
  const { bodies, fetch } = wire();
  const providers = customModelProviders(
    configured({ minterModel: "vendor-minter" }),
    "synthetic",
    { fetch: fetch as typeof fetch },
  );
  const model = await providers.minter.getModel(solModel);
  const compatibility = request({
    systemInstructions: "Shared instructions.",
    input: [
      {
        type: "unknown",
        providerData: {
          type: "message",
          role: "developer",
          content: [
            { type: "input_text", text: "Instructions part one." },
            {
              type: "input_text",
              text: "Instructions part two.",
              prompt_cache_breakpoint: { mode: "explicit", ttl: "12h" },
            },
          ],
        },
      },
      {
        type: "unknown",
        providerData: { type: "configuration_update", reasoning: { effort: "low" } },
      },
      { role: "user", type: "message", content: "Go" },
    ],
    tools: [tool("kept_tool"), tool("dropped_tool")],
    modelSettings: {
      store: false,
      reasoning: { effort: "medium" },
      providerData: {
        prompt_cache_options: { mode: "implicit" },
        prompt_cache_key: "vendor",
        include: ["reasoning.encrypted_content"],
        tool_choice: {
          type: "allowed_tools",
          mode: "required",
          tools: [{ type: "function", name: "kept_tool" }],
        },
      },
    },
  });
  await withTrace("custom providers", async () => {
    await model.getResponse(compatibility);
  });
  const body = JSON.stringify(bodies[0]);
  expect(body).not.toContain("prompt_cache_options");
  expect(body).not.toContain("prompt_cache_key");
  expect(body).not.toContain("reasoning.encrypted_content");
  expect(body).not.toContain("prompt_cache_breakpoint");
  expect(body).not.toContain("configuration_update");
  expect(body).not.toContain("input_text");
  expect(bodies[0]?.["store"]).toBeUndefined();
  const sent = bodies[0] as { messages?: { role?: string; content?: unknown }[] };
  expect(sent.messages?.map((message) => message.role)).toEqual(["system", "system", "user"]);
  expect(sent.messages?.[1]?.content).toBe("Instructions part one.\nInstructions part two.");
  expect(bodies[0]?.["tool_choice"]).toBe("required");
  expect((bodies[0]?.["tools"] as { function?: { name?: string } }[])?.map((entry) => entry.function?.name)).toEqual([
    "kept_tool",
  ]);
});

it("skips a prewarm request without sending it", async () => {
  const { bodies, fetch } = wire();
  const providers = customModelProviders(configured({ minterModel: "vendor-minter" }), "synthetic", {
    fetch: fetch as typeof fetch,
  });
  const model = await providers.minter.getModel(solModel);
  const response = await model.getResponse(
    request({
      modelSettings: {
        providerData: { prompt_cache_options: { mode: "explicit", prewarm: true } },
      },
    }),
  );
  expect(bodies).toEqual([]);
  expect(response.usage.totalTokens).toBe(0);
});

it("fails the call when the provider rejects the request", async () => {
  const { fetch } = wire(() =>
    new Response(JSON.stringify({ error: { message: "Unknown parameter", type: "invalid_request_error" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  );
  const providers = customModelProviders(configured({ minterModel: "vendor-minter" }), "synthetic", {
    fetch: fetch as typeof fetch,
  });
  const model = await providers.minter.getModel(solModel);
  await withTrace("custom providers", async () => {
    await expect(model.getResponse(request())).rejects.toThrow();
  });
});

it("passes a provider error through instead of answering", async () => {
  const failure = new Error("provider refused");
  const failing = {
    getResponse: () => Promise.reject(failure),
    getStreamedResponse: () => {
      throw failure;
    },
  };
  const compatible = chatCompatibleModel(failing);
  await expect(compatible.getResponse(request())).rejects.toBe(failure);
});

it("keeps a plain request untouched for the compatibility endpoint", async () => {
  const { requests, model } = recordingModel();
  const compatible = chatCompatibleModel(model);
  const plain = request({
    modelSettings: { temperature: 0.2, maxTokens: 64, toolChoice: "auto", parallelToolCalls: false },
  });
  await compatible.getResponse(plain);
  expect(requests[0]?.modelSettings).toEqual({
    temperature: 0.2,
    maxTokens: 64,
    toolChoice: "auto",
    parallelToolCalls: false,
  });
});

const wired = (over: Partial<Record<string, string | undefined>>) =>
  withConfiguredModelProviders({ ask: undefined } as unknown as PomeradoOptions, {
    POMERADO_MODEL_BASE_URL: baseURL,
    POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
    VENDOR_API_KEY: "synthetic",
    ...over,
  });

it("fills only the providers a custom configuration selects", () => {
  const options = wired({});
  expect(options.minterProvider).toBeDefined();
  expect(options.guardianProvider).toBeDefined();
  expect(options.outcomeReviewerProvider).toBeDefined();
  const explicit = { getModel: async () => recordingModel().model } satisfies ModelProvider;
  expect(wired({}).minterProvider).not.toBe(explicit);
  expect(
    withConfiguredModelProviders(
      { ask: undefined, minterProvider: explicit } as unknown as PomeradoOptions,
      {
        POMERADO_MODEL_BASE_URL: baseURL,
        POMERADO_MODEL_API_KEY_ENV: apiKeyEnv,
        VENDOR_API_KEY: "synthetic",
      },
    ).minterProvider,
  ).toBe(explicit);
});

it("leaves options untouched with no custom configuration", () => {
  const options = { ask: undefined } as unknown as PomeradoOptions;
  expect(withConfiguredModelProviders(options, {})).toBe(options);
});

it("refuses to start a session whose provider configuration is invalid", async () => {
  await expect(
    Effect.runPromise(
      Effect.scoped(
        createPomerado({ ask: undefined } as unknown as PomeradoOptions, {
          POMERADO_MODEL_BASE_URL: baseURL,
        }),
      ),
    ),
  ).rejects.toThrow("POMERADO_MODEL_API_KEY_ENV");
});
