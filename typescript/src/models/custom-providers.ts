import { OpenAI } from "openai";
import { OpenAIChatCompletionsModel, OpenAIResponsesModel, Usage } from "@openai/agents";
import type {
  AgentInputItem,
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelSettings,
} from "@openai/agents";

/**
 * An opt-in provider for an OpenAI-compatible endpoint other than OpenAI's own, such as Z.ai GLM
 * or OpenRouter. Nothing here applies unless `POMERADO_MODEL_BASE_URL` is set: without it every
 * runtime agent keeps the SDK's default OpenAI provider, its `OPENAI_API_KEY` and the built-in
 * model IDs in `models.ts`.
 */

/** The wire protocol a custom endpoint speaks. Chat Completions is the broadly compatible one. */
export type ModelProtocol = "chat_completions" | "responses";

/** A custom provider as the environment configures it. No key value is ever read here. */
export interface CustomModelProviderConfig {
  /** The endpoint's base URL, such as `https://open.bigmodel.cn/api/paas/v4`. */
  readonly baseURL: string;
  /** The name of the environment variable that holds the endpoint's API key. */
  readonly apiKeyEnv: string;
  readonly protocol: ModelProtocol;
  /** Each role's model ID; a role without one keeps the model ID the runtime asks for. */
  readonly minterModel?: string;
  readonly guardianModel?: string;
  readonly outcomeReviewerModel?: string;
}

export type ModelProviderSetup =
  | { readonly provider: "default" }
  | { readonly provider: "custom"; readonly config: CustomModelProviderConfig }
  | { readonly provider: "invalid"; readonly reason: string };

const protocols: readonly ModelProtocol[] = ["chat_completions", "responses"];

/**
 * Reads the custom provider configuration from an environment. `POMERADO_MODEL_BASE_URL` opts in;
 * `POMERADO_MODEL_API_KEY_ENV` then names the variable holding the key (never the key itself), so
 * no key value reaches configuration, logs or errors. `POMERADO_MODEL_PROTOCOL` selects the wire
 * protocol and defaults to `chat_completions`, the protocol compatible endpoints broadly accept;
 * `responses` keeps OpenAI-specific settings for endpoints that truly implement the Responses API.
 */
export const modelProviderSetup = (
  env: Readonly<Record<string, string | undefined>>,
): ModelProviderSetup => {
  const baseURL = env["POMERADO_MODEL_BASE_URL"];
  if (baseURL === undefined || baseURL === "") return { provider: "default" };
  const apiKeyEnv = env["POMERADO_MODEL_API_KEY_ENV"];
  if (apiKeyEnv === undefined || apiKeyEnv === "")
    return {
      provider: "invalid",
      reason:
        "POMERADO_MODEL_API_KEY_ENV must name the environment variable that holds the custom provider's API key when POMERADO_MODEL_BASE_URL is set; it never holds the key itself.",
    };
  const key = env[apiKeyEnv];
  if (key === undefined || key === "")
    return {
      provider: "invalid",
      reason: `POMERADO_MODEL_API_KEY_ENV names ${apiKeyEnv}, which is not set; the custom provider needs its key there.`,
    };
  const named = env["POMERADO_MODEL_PROTOCOL"];
  const protocol = named === undefined || named === "" ? "chat_completions" : named;
  if (!protocols.includes(protocol as ModelProtocol))
    return {
      provider: "invalid",
      reason: `POMERADO_MODEL_PROTOCOL must be chat_completions or responses, not ${named}.`,
    };
  return {
    provider: "custom",
    config: {
      baseURL,
      apiKeyEnv,
      protocol: protocol as ModelProtocol,
      ...(env["POMERADO_MINTER_MODEL"] === undefined || env["POMERADO_MINTER_MODEL"] === ""
        ? {}
        : { minterModel: env["POMERADO_MINTER_MODEL"] }),
      ...(env["POMERADO_GUARDIAN_MODEL"] === undefined || env["POMERADO_GUARDIAN_MODEL"] === ""
        ? {}
        : { guardianModel: env["POMERADO_GUARDIAN_MODEL"] }),
      ...(env["POMERADO_OUTCOME_REVIEWER_MODEL"] === undefined ||
      env["POMERADO_OUTCOME_REVIEWER_MODEL"] === ""
        ? {}
        : { outcomeReviewerModel: env["POMERADO_OUTCOME_REVIEWER_MODEL"] }),
    },
  };
};

/** Settings the Chat Completions protocol takes; everything else below is Responses-only. */
const portableSettings = (settings: ModelSettings): ModelSettings => {
  const {
    store: _store,
    truncation: _truncation,
    reasoning: _reasoning,
    text: _text,
    promptCacheRetention: _promptCacheRetention,
    promptCacheOptions: _promptCacheOptions,
    providerData: _providerData,
    ...portable
  } = settings;
  return portable;
};

/** The `allowed_tools` restriction a request's provider data holds, as the Responses API writes it. */
const toolRestrictionOf = (providerData: unknown) => {
  if (typeof providerData !== "object" || providerData === null) return undefined;
  const choice: unknown = Reflect.get(providerData, "tool_choice");
  if (typeof choice !== "object" || choice === null) return undefined;
  if (Reflect.get(choice, "type") !== "allowed_tools") return undefined;
  const mode = Reflect.get(choice, "mode");
  const tools: unknown = Reflect.get(choice, "tools");
  if (typeof tools !== "object" || !Array.isArray(tools)) return undefined;
  return { mode: mode === "required" ? "required" : "auto", tools };
};

/** How `allowed_tools` names one tool of a request, mirroring the reference the restriction sent. */
const restrictionNames = (tool: NonNullable<ModelRequest["tools"]>[number]) => {
  if (tool.type === "function") return [`function:${tool.name}`];
  if (tool.type === "hosted_tool") {
    const sent: unknown = tool.providerData?.["type"];
    return [tool.name, ...(typeof sent === "string" ? [sent] : [])];
  }
  return [tool.type];
};

/** The tool list an `allowed_tools` restriction keeps, with its References translated to names. */
const allowedTools = (
  tools: readonly unknown[],
  requestTools: ReadonlyArray<NonNullable<ModelRequest["tools"]>[number]>,
) => {
  const admitted = new Set(
    tools.flatMap((reference) => {
      if (typeof reference !== "object" || reference === null) return [];
      const type: unknown = Reflect.get(reference, "type");
      const name: unknown = Reflect.get(reference, "name");
      return typeof name === "string" && type === "function"
        ? [`function:${name}`]
        : typeof type === "string"
          ? [type]
          : [];
    }),
  );
  return requestTools.filter((tool) =>
    restrictionNames(tool).some((name) => admitted.has(name)),
  );
};

const inputTexts = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) return undefined;
  const texts = content.flatMap((part) =>
    typeof part === "object" && part !== null && typeof Reflect.get(part, "text") === "string"
      ? [Reflect.get(part, "text") as string]
      : [],
  );
  return texts.length === 0 ? undefined : texts.join("\n");
};

/**
 * One input item as Chat Completions takes it. The host sends its shared instructions as a
 * developer message with a cache breakpoint and reasoning-effort changes as configuration
 * updates, both Responses-only: the message becomes a plain system message with its texts, and a
 * configuration update, whose protocol has no Chat Completions counterpart, is dropped. Any other
 * unknown item passes through as the provider wrote it.
 */
const chatCompatibleItem = (item: AgentInputItem): AgentInputItem | undefined => {
  if (item.type !== "unknown") return item;
  const data: unknown = item.providerData;
  if (typeof data !== "object" || data === null) return item;
  const type: unknown = Reflect.get(data, "type");
  if (type === "configuration_update") return undefined;
  if (type !== "message") return item;
  const role: unknown = Reflect.get(data, "role");
  if (role !== "developer" && role !== "system") return item;
  const text = inputTexts(Reflect.get(data, "content"));
  if (text === undefined) return item;
  return { type: "message", role: "system", content: text };
};

/**
 * A request the Chat Completions protocol accepts: no Responses-only settings or provider data —
 * prompt cache options and keys, encrypted reasoning includes, response storage, reasoning
 * summaries — an `allowed_tools` restriction kept by filtering the tool list it admits, and
 * input items rewritten as above. Tool calls, outputs and the full conversation state otherwise
 * travel unchanged, and every call stays stateless.
 */
export const cleanChatCompletionsRequest = (request: ModelRequest): ModelRequest => {
  const restriction = toolRestrictionOf(request.modelSettings.providerData);
  const settings = portableSettings(request.modelSettings);
  return {
    ...request,
    ...(restriction === undefined
      ? { modelSettings: settings }
      : {
          tools: allowedTools(restriction.tools, request.tools ?? []),
          modelSettings: { ...settings, toolChoice: restriction.mode },
        }),
    ...(typeof request.input === "string"
      ? {}
      : {
          input: request.input.flatMap((item) => {
            const compatible = chatCompatibleItem(item);
            return compatible === undefined ? [] : [compatible];
          }),
        }),
  };
};

/** A request that only prepares the provider's prompt cache: a Responses-only optimization. */
const prewarmRequest = (request: ModelRequest): boolean => {
  const providerData: unknown = request.modelSettings.providerData;
  if (typeof providerData !== "object" || providerData === null) return false;
  const options: unknown = Reflect.get(providerData, "prompt_cache_options");
  return (
    typeof options === "object" && options !== null && Reflect.get(options, "prewarm") === true
  );
};

/**
 * A model whose requests a Chat Completions endpoint accepts. A prewarm request needs no answer
 * from the provider, so it completes at once with no call and no tokens; any provider error of a
 * real call passes through as the failure it is.
 */
export const chatCompatibleModel = (model: Model): Model => ({
  ...(model.supportsPromptModelSelection === undefined
    ? {}
    : { supportsPromptModelSelection: model.supportsPromptModelSelection }),
  getResponse: (request: ModelRequest): Promise<ModelResponse> =>
    prewarmRequest(request)
      ? Promise.resolve({ usage: new Usage(), output: [] })
      : model.getResponse(cleanChatCompletionsRequest(request)),
  getStreamedResponse: (request: ModelRequest) =>
    model.getStreamedResponse(cleanChatCompletionsRequest(request)),
  ...(model.getRetryAdvice === undefined
    ? {}
    : {
        getRetryAdvice: (
          args: Parameters<NonNullable<Model["getRetryAdvice"]>>[0],
        ) => model.getRetryAdvice?.(args),
      }),
});

/**
 * The model providers for a custom endpoint: one per role, each sending its configured model ID
 * in place of the built-in one the runtime names. `key` is read once by the caller, from the
 * variable `config.apiKeyEnv` names, and reaches no code but the client. Chat Completions
 * requests are cleaned for compatibility; `responses` sends them as built.
 */
export const customModelProviders = (
  config: CustomModelProviderConfig,
  key: string,
  options: { readonly fetch?: typeof fetch } = {},
): {
  readonly minter: ModelProvider;
  readonly guardian: ModelProvider;
  readonly outcomeReviewer: ModelProvider;
} => {
  const client = new OpenAI({
    apiKey: key,
    baseURL: config.baseURL,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const role = (modelId: string | undefined): ModelProvider => ({
    getModel: async (requested?: string) => {
      const id = modelId ?? requested;
      if (id === undefined)
        throw new Error("The custom provider has no model ID for a role that named none.");
      return config.protocol === "responses"
        ? new OpenAIResponsesModel(client, id)
        : chatCompatibleModel(new OpenAIChatCompletionsModel(client, id));
    },
  });
  return {
    minter: role(config.minterModel),
    guardian: role(config.guardianModel),
    outcomeReviewer: role(config.outcomeReviewerModel),
  };
};
