import { OpenAI } from "openai";
import { Usage } from "@openai/agents";
import { OpenAIChatCompletionsModel } from "@openai/agents";
import type { ModelProvider, ModelRequest, ModelResponse } from "@openai/agents";
import { afterEach, expect, it } from "vitest";
import { makeOpenAIMinter } from "../../src/mint/openai.js";
import { chatCompatibleModel } from "../../src/models/custom-providers.js";
import { modelWithOverrides } from "../../src/models/model-wrap.js";
import { makeMintContinuationFixture } from "../support/mint-fixtures.js";
import { portableJobSession } from "../support/portable-mint.js";

/**
 * The minter wraps the provider's model twice — the request layout and the run-loop call wrapper —
 * and the SDK's capability machinery reads the model instance's constructor to choose between the
 * hosted, Responses-only sandbox tools and the plain-function ones. This test runs a real mint
 * turn through the model a custom Chat Completions provider returns and checks the request the
 * minter actually builds: the sandbox tools must be the plain-function ones that endpoint
 * accepts, with apply_patch a function tool. No request leaves the process; the endpoint is
 * synthetic and the responses scripted.
 */

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const usage = () => new Usage({ requests: 1, inputTokens: 2, outputTokens: 1, totalTokens: 3 });

const ask = (): ModelResponse => ({
  usage: usage(),
  output: [
    {
      type: "function_call",
      name: "request_input",
      callId: "ask",
      arguments: JSON.stringify({
        questions: [{ id: "report", type: "text", prompt: "Which public report?" }],
        intent: "Synthetic request_input purpose",
      }),
      status: "completed",
    },
  ],
});

const prose = (): ModelResponse => ({
  usage: usage(),
  output: [
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Stopped." }],
    },
  ],
});

it("sends a mint through a chat completions provider only the tools that endpoint accepts", async () => {
  const requests: ModelRequest[] = [];
  const client = new OpenAI({ apiKey: "synthetic", baseURL: "https://vendor.example.test/v1" });
  const chatModel = chatCompatibleModel(new OpenAIChatCompletionsModel(client, "vendor-model"));
  const provider: ModelProvider = {
    getModel: async () =>
      modelWithOverrides(chatModel, {
        getResponse: async (request) => {
          requests.push(request);
          return requests.length === 1 ? ask() : prose();
        },
        getStreamedResponse: () => {
          throw new Error("Unused stream");
        },
      }),
  };
  const fixture = makeMintContinuationFixture(cleanups, portableJobSession, makeOpenAIMinter);
  const run = await fixture(() => prose(), {
    model: makeOpenAIMinter(provider, "medium", {}),
  });
  await run.run().catch(() => undefined);
  expect(requests.length).toBeGreaterThan(0);
  const tools = requests.flatMap((request) => [...(request.tools ?? [])]);
  expect(tools.find((entry) => entry.name === "apply_patch")?.type).toBe("function");
  expect(tools.find((entry) => entry.name === "exec_command")?.type).toBe("function");
  expect(tools.some((entry) => entry.type === "hosted_tool")).toBe(false);
});
