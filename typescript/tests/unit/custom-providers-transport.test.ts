import { OpenAI } from "openai";
import { expect, it } from "vitest";
import { OpenAIChatCompletionsModel, OpenAIResponsesModel } from "@openai/agents";
import type { Editor, Model, ModelRequest } from "@openai/agents";
import { filesystem, shell } from "@openai/agents/sandbox";
import type { Capability, SandboxSessionLike } from "@openai/agents/sandbox";
import { chatCompatibleModel } from "../../src/models/custom-providers.js";
import { modelWithOverrides } from "../../src/models/model-wrap.js";

/**
 * The SDK's sandbox capability machinery reads the model instance's constructor name to choose
 * transports: a name containing "ChatCompletions" gets the plain-function apply_patch tool and
 * text tool outputs; anything else gets Responses-only hosted tools, which a Chat Completions
 * endpoint refuses. These tests bind the real capabilities the minter advertises to the model a
 * custom provider returns, exactly as the SDK binds them for a SandboxAgent, so the transport the
 * endpoint will see is the one under test. No request leaves the process.
 */

const client = new OpenAI({ apiKey: "synthetic", baseURL: "https://vendor.example.test/v1" });

/** An editor the filesystem capability can bind; nothing calls it in these tests. */
const editor = (): Editor => ({
  createFile: async () => undefined,
  updateFile: async () => undefined,
  deleteFile: async () => undefined,
});

/** A session the filesystem and shell capabilities accept, with the facilities they ask for. */
const session = (): SandboxSessionLike =>
  ({
    createEditor: () => editor(),
    execCommand: async () => ({ output: "" }),
  }) as unknown as SandboxSessionLike;

/** The tools the filesystem and shell capabilities offer once the SDK binds them to `model`. */
const capabilityTools = (model: object) => {
  const bound = (capability: Capability) =>
    capability.bind(session()).bindModel("vendor-model", model as never);
  return [...bound(filesystem()).tools(), ...bound(shell()).tools()];
};

it("offers the filesystem and shell capabilities as plain function tools on chat completions", () => {
  const model = chatCompatibleModel(new OpenAIChatCompletionsModel(client, "vendor-model"));
  const tools = capabilityTools(model);
  expect(tools.map((entry) => entry.type)).toEqual(
    Array.from({ length: tools.length }, () => "function"),
  );
  const applyPatch = tools.find((entry) => entry.name === "apply_patch");
  expect(applyPatch?.type).toBe("function");
  expect(tools.map((entry) => entry.name)).toContain("exec_command");
});

it("keeps that function transport through model wrappers that preserve the prototype", () => {
  const model: Model = chatCompatibleModel(new OpenAIChatCompletionsModel(client, "vendor-model"));
  // Two wrapper layers, as the minter's provider chain wraps a model: the transport the SDK
  // reads must survive both.
  const passthrough = (request: ModelRequest) => model.getResponse(request);
  const wrapped = modelWithOverrides(
    modelWithOverrides(model, { getResponse: passthrough }),
    { getResponse: passthrough },
  );
  const tools = capabilityTools(wrapped);
  expect(tools.find((entry) => entry.name === "apply_patch")?.type).toBe("function");
});

it("keeps the hosted apply_patch transport for the responses protocol", () => {
  const model = new OpenAIResponsesModel(client, "vendor-model");
  const tools = capabilityTools(model);
  expect(tools.find((entry) => entry.name === "apply_patch")?.type).toBe("apply_patch");
});
