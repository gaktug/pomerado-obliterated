# Getting started with Pomerado Obliterated

This is the [gaktug/Pomerado Obliterated fork](https://github.com/gaktug/pomerado-obliterated), not the upstream npm package. It builds browser-backed MCP tools for agents with a configurable model provider. Upstream Pomerado's Cloud service and npm package are separate.

## Install

Use Linux or macOS, Git, npm and Node **24.21+ but below 25**. Check `node --version` first. Then install the fork from GitHub and its matching Chromium:

```sh
npm install -g 'git+https://github.com/gaktug/pomerado-obliterated.git#main'
npx -y -p playwright@1.63.0 playwright install chromium
pomerado-obliterated-mcp --help
command -v pomerado-obliterated-mcp
```

Pin `#main` to a tested commit SHA if repeatability matters. No npm publishing is needed. `npm install -g pomerado` and `npx -p pomerado` install the **upstream**, not this fork. If Linux lacks browser libraries, run `npx -y -p playwright@1.63.0 playwright install --with-deps chromium` with sudo approval. Do not use another Chromium revision as proof that installation works.

## Another model provider

Set these in the environment of the MCP server. The first variable opts into a custom provider; omit it to use the upstream OpenAI default (`OPENAI_API_KEY`, upstream model IDs). A run of an already-built integration makes no model request.

- `POMERADO_MODEL_BASE_URL`: provider API base URL. HTTPS required remotely; HTTP only for local loopback.
- `POMERADO_MODEL_API_KEY_ENV`: **name** of the key variable, e.g. `GLM_API_KEY`, not the key itself.
- `POMERADO_MODEL_PROTOCOL`: `chat_completions` (default) or `responses` for a true Responses API.
- `POMERADO_MINTER_MODEL`, `POMERADO_GUARDIAN_MODEL`, `POMERADO_OUTCOME_REVIEWER_MODEL`: model IDs for each role. Set all three unless your provider accepts upstream IDs.

For Z.ai Coding Plan with GLM-5.3:

```sh
export POMERADO_MODEL_BASE_URL=https://api.z.ai/api/coding/paas/v4
export POMERADO_MODEL_API_KEY_ENV=GLM_API_KEY
export GLM_API_KEY='your-key'
export POMERADO_MODEL_PROTOCOL=chat_completions
export POMERADO_MINTER_MODEL=GLM-5.3
export POMERADO_GUARDIAN_MODEL=GLM-5.3
export POMERADO_OUTCOME_REVIEWER_MODEL=GLM-5.3
```

For OpenRouter, use `https://openrouter.ai/api/v1`, `OPENROUTER_API_KEY`, and model IDs it currently offers, e.g. `z-ai/glm-5.3`. A live read-only mint and separate artifact run were completed with that combination. Some cheaper models did not complete the same task; protocol support is not a quality guarantee. A provider refusal or exhausted quota stops the mint rather than manufacturing an artifact. Chat Completions omits Responses-only caching/compaction and uses local function tools for editing and shell; long sessions may hit a provider's context limit.

## Connect an MCP client

The server's executable is `pomerado-obliterated-mcp`. Use the absolute path printed by `command -v` in graphical clients whose PATH may be different. The following is a standard `mcpServers` entry; replace the two placeholder paths:

```json
{
  "mcpServers": {
    "pomerado-obliterated": {
      "command": "/absolute/path/to/pomerado-obliterated-mcp",
      "args": ["mint", "--root", "/absolute/path/to/integrations"]
    }
  }
}
```

The MCP client must pass through `POMERADO_MODEL_BASE_URL`, `POMERADO_MODEL_API_KEY_ENV`, `POMERADO_MODEL_PROTOCOL`, all three model IDs, and the actual provider key variable. Keep the **key value** out of project-shared config and chat; use your client's private secret/environment mechanism. A tool-call timeout of at least 60 seconds is useful; `mint` itself returns a job ID quickly, `get_job` may wait 30 seconds. Listing the four tools (`mint`, `get_job`, `provide_input`, `cancel_job`) uses no browser or model.

Client-specific examples below are configurations, **not** claims that this fork was live-tested with each client:

- **Claude Code:** `claude mcp add --scope user pomerado-obliterated -- /absolute/path/to/pomerado-obliterated-mcp mint --root /absolute/path/to/integrations`. It inherits its launching shell's environment. See [Claude MCP docs](https://code.claude.com/docs/en/mcp).
- **Codex:** `codex mcp add pomerado-obliterated -- /absolute/path/to/pomerado-obliterated-mcp mint --root /absolute/path/to/integrations`. In `[mcp_servers.pomerado-obliterated]` add `env_vars = ["POMERADO_MODEL_BASE_URL", "POMERADO_MODEL_API_KEY_ENV", "POMERADO_MODEL_PROTOCOL", "POMERADO_MINTER_MODEL", "POMERADO_GUARDIAN_MODEL", "POMERADO_OUTCOME_REVIEWER_MODEL", "GLM_API_KEY"]` (substitute your key variable) and `startup_timeout_sec = 60`. `env_vars` passes variable names from Codex's environment, not their values. See [Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- **Cursor, VS Code, Claude Desktop, Gemini CLI:** use the client's local stdio MCP configuration, its actual executable path, and its environment/secret pass-through. Some clients strip `*_KEY` variables; test that the server actually receives the chosen key. Never put an upstream `npx -p pomerado` command into the configuration.

## Build and use an integration

Ask your connected agent:

> Mint a read-only tool named `iana_heading` to read the main H1 heading at https://www.iana.org/domains/reserved. Do not change the site.

The agent calls `mint` with a name, URL, intent and `read` effect, then follows the returned job with `get_job` (do not start it again). A published integration is saved beneath `--root` with `mcp.json` and its own README for adding it as an MCP server. `build: incomplete` means **no artifact was published**; inspect its summary. Use `write` authority only when you intend a real website change **during minting**. If a write may have committed, check the website before retrying.

An integration run is model-free. Its files include `pomerado.json`, a compatibility artifact format from upstream. The authoring runtime still supports `pomerado/runtime` imports, also for compatibility; neither identifier selects an npm package.

Questions, login details and one-time codes supplied via `provide_input` pass through your MCP client and its model provider; the local server does not save them. A human should approve the chosen login/secret handling in their client. For the design and limits, see [How it works](how-it-works.md).

## Troubleshooting

- `node --version` is outside Node 24.21–24.x: switch Node before starting the server.
- `pomerado-obliterated-mcp` is missing: check the Git install completed and inspect `command -v`; a successful `npm pack` alone does not install it.
- Browser missing or failed to launch: run `npx -y -p playwright@1.63.0 playwright install chromium`; if system libraries are missing, use `--with-deps` after approval. Network-blocked downloads remain a blocker.
- Mint stops on provider authentication/quota: check that your client passed the key variable, endpoint, protocol and role IDs, then check the provider's own quota.
- MCP server disconnects or a job vanishes after restart: relaunch the client/server. In-memory running jobs do not survive restart, but published integrations remain on disk.
