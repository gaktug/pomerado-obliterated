import { Effect, type Scope } from "effect";
import type { Pomerado, PomeradoOptions } from "./contracts.js";
import { makeSession } from "./session.js";
import { requestContext } from "./request-context.js";
import { mintRequest } from "./mint-host.js";
import { runOperation } from "./run-operation.js";
import { issueFileHandles } from "../mint/file-handles.js";
import { isLocalFileReference, openLocalFile } from "../execution/local-files.js";
import { customModelProviders, modelProviderSetup, type ModelProviderSetup } from "../models/custom-providers.js";
export { Artifact } from "./contracts.js";
export type {
  Pomerado,
  PomeradoOptions,
  PomeradoRequest,
  MintArtifact,
  MintOutcome,
  LocalMintOutcome,
} from "./contracts.js";
/**
 * Fills each role's model provider from the environment's custom provider configuration when the
 * caller passed none of its own; a provider the caller chose always wins. With no configuration,
 * or the default one, the options pass through untouched, so the default OpenAI path never
 * changes. An invalid configuration was already refused before this runs.
 */
export const withConfiguredModelProviders = (
  options: PomeradoOptions,
  env: Readonly<Record<string, string | undefined>>,
): PomeradoOptions => {
  const setup: ModelProviderSetup = modelProviderSetup(env);
  if (setup.provider !== "custom") return options;
  const key = env[setup.config.apiKeyEnv] ?? "";
  const providers = customModelProviders(setup.config, key);
  return {
    ...options,
    minterProvider: options.minterProvider ?? providers.minter,
    guardianProvider: options.guardianProvider ?? providers.guardian,
    outcomeReviewerProvider: options.outcomeReviewerProvider ?? providers.outcomeReviewer,
  };
};

/** A scoped session owns its browser, so a minted operation can run in the same signed-in session. */
export const createPomerado = (
  options: PomeradoOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Effect.Effect<Pomerado, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const setup = modelProviderSetup(env);
    if (setup.provider === "invalid") return yield* Effect.fail(new Error(setup.reason));
    const session = yield* makeSession(withConfiguredModelProviders(options, env));
    const mint: Pomerado["mint"] = (request) =>
      session.mutex.withPermits(1)(
        Effect.scoped(
          Effect.gen(function* () {
            // The build sees each of the caller's files as a handle, never its reference.
            const issued = yield* issueFileHandles(
              request.input ?? {},
              isLocalFileReference,
              openLocalFile,
            );
            const handled = { ...request, input: issued.input };
            const context = yield* requestContext(session, handled);
            return yield* mintRequest(session, context, handled, issued.handles);
          }),
        ),
      );
    const run: Pomerado["run"] = (artifact, request) =>
      session.mutex.withPermits(1)(Effect.scoped(runOperation(session, artifact, request)));
    return { mint, run };
  });
