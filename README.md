# Pomerado Obliterated

**Turn websites into repeatable tools for AI agents, using the model provider you choose.**

This is an independent, MIT-licensed fork of [Pomerado](https://github.com/Pomerado/pomerado). It mints local browser-backed integrations from a URL and a natural-language task, reviews their actions and generated source, and serves the resulting tools over MCP. It does not require Pomerado Cloud or an OpenAI API key: use an OpenAI-compatible Chat Completions endpoint (including Z.ai or OpenRouter), a Responses-compatible endpoint, or the upstream OpenAI default. Provider compatibility is not a promise that every model can complete every mint.

**Not on npm.** The package named `pomerado` on npm belongs to the upstream project. Install this fork from GitHub as shown below; `npx -p pomerado` does **not** install this fork.

## Requirements and install

- Linux or macOS; Node **24.21+ within the Node 24 line** (`node --version`), npm and Git.
- A model API key for minting, plus Chromium. Running an already minted integration needs no model key.
- For agent use, an MCP client that can start a local stdio server.

```sh
npm install -g 'git+https://github.com/gaktug/pomerado-obliterated.git#main'
npx -y -p playwright@1.63.0 playwright install chromium
pomerado-obliterated-mcp --help
```

The first command builds this fork from Git source; it does not fetch an upstream npm release. To freeze an installation, replace `#main` with a tested commit SHA. If npm's script-approval feature blocks the build (npm warns about `install-scripts`, or the `pomerado-obliterated-mcp` command is missing afterwards), rerun the install with `--foreground-scripts` and approve this package's scripts, or build from a clone with `npm install && npm run build && npm link`. Install the matching Playwright Chromium using the second command. If Linux reports missing browser libraries, run `npx -y -p playwright@1.63.0 playwright install --with-deps chromium` (requires sudo). If a browser download is blocked, the tool is **not** fully installed; do not silently substitute another Chromium revision. Client applications may need an absolute executable path: find it with `command -v pomerado-obliterated-mcp`.

## Choose a model provider

The three roles—minter, Guardian reviewer, and write-outcome reviewer—can use different model IDs on the same endpoint. For Z.ai Coding Plan, for example, export these in the environment that starts your MCP client:

```sh
export POMERADO_MODEL_BASE_URL=https://api.z.ai/api/coding/paas/v4
export POMERADO_MODEL_API_KEY_ENV=GLM_API_KEY
export GLM_API_KEY='your-key'
export POMERADO_MODEL_PROTOCOL=chat_completions
export POMERADO_MINTER_MODEL=GLM-5.3
export POMERADO_GUARDIAN_MODEL=GLM-5.3
export POMERADO_OUTCOME_REVIEWER_MODEL=GLM-5.3
```

`POMERADO_MODEL_API_KEY_ENV` is the **variable name**, not the secret. Do not put an API key in a shared MCP JSON file. An OpenRouter setup uses `https://openrouter.ai/api/v1`, `OPENROUTER_API_KEY`, and model IDs that OpenRouter currently offers (for example, `z-ai/glm-5.3`). Without `POMERADO_MODEL_BASE_URL`, the original OpenAI path remains the default and requires `OPENAI_API_KEY` plus access to the upstream models. Only HTTPS remote endpoints are accepted; loopback HTTP is allowed for local providers. See [provider details](docs/getting-started.md#another-model-provider).

## Connect an agent

Launch the minting MCP server from the **installed fork**, not an upstream `npx` package:

```json
{
  "mcpServers": {
    "pomerado-obliterated": {
      "command": "/absolute/path/from/command-v/pomerado-obliterated-mcp",
      "args": ["mint", "--root", "/absolute/path/to/integrations"]
    }
  }
}
```

Use `command -v pomerado-obliterated-mcp` to get the real command path; substitute it in the JSON. The client must inherit the provider variables above, and its tool-call timeout should be at least 60 seconds. On startup it exposes `mint`, `get_job`, `provide_input` and `cancel_job`; listing tools makes no model request. For client-specific settings, see [Getting started](docs/getting-started.md) and [Agent setup](docs/agent-setup.md).

Ask your agent:

> Mint a read-only tool named `iana_heading` to return the main H1 heading from https://www.iana.org/domains/reserved. Do not change the site.

`mint` returns a job ID; `get_job` reports progress or questions. Choose `read` for observation, `write` only when authorizing a real website change. A write mint can perform the action **during** construction. After publication the generated integration has its own `README.md` and `mcp.json` for connection to an MCP client. A run of an existing artifact is deterministic and makes no model call; edited artifacts are not re-reviewed automatically. Check the website before retrying an uncertain write.

For terminal use instead of MCP:

```sh
pomerado-obliterated mint --url https://www.iana.org/domains/reserved --intent 'Read the main H1 heading' --effect read --out ./iana-heading
pomerado-obliterated run --artifact ./iana-heading --url https://www.iana.org/domains/reserved
```

The second command needs no model key. In a live read-only test of the fork, the saved integration returned `{"heading":"IANA-managed Reserved Domains"}`. The example page may change; use another public page with an H1 if it does. Minting can take many model calls and may exhaust a provider quota.

## Source and limits

The package exposes the original `pomerado/runtime` authored-operation interface and the `pomerado.json` artifact format for compatibility; those are internal compatibility names, **not** instructions to install the upstream npm package. The fork does not provide Pomerado Cloud's hosting, saved logins, OAuth brokerage, managed browser fleet or automatic repair. See [How it works](docs/how-it-works.md) for runtime architecture. Report fork issues at [gaktug/pomerado-obliterated/issues](https://github.com/gaktug/pomerado-obliterated/issues); do not send fork support requests to the upstream team.

## License and attribution

Original Pomerado code copyright © 2026 Pomerado AI, Inc., MIT license; fork modifications retain that license. See [LICENSE](LICENSE). Versions 0.1.2 and earlier of upstream were AGPL-3.0-only. The Guardian policy includes adapted OpenAI Codex material and the accessible-name implementation includes adapted Playwright material; their Apache-2.0 notices remain in [third-party/](third-party/). Pomerado Cloud, its docs and its Discord are operated by the **upstream project**, not this fork.
