# Set up Pomerado Obliterated for a user

This guide is for an agent asked to install the [gaktug/Pomerado Obliterated fork](https://github.com/gaktug/pomerado-obliterated). Do **not** substitute the upstream npm `pomerado` package. Ask before changing the user's Node installation, global packages, MCP client settings or sudo-managed browser libraries. Never ask for an API key, password or one-time code in ordinary chat; let the user configure secrets through their client's private mechanism. Report exactly what you verified.

## 1. Check prerequisites

- Linux or macOS; Node 24.21+ and below 25, npm and Git.
- An MCP client that starts a local stdio server.
- A provider endpoint and model IDs the user wants. For GLM-5.3 via Z.ai Coding Plan, use the known settings below. Do not promise another model can finish a mint just because its endpoint accepts tool calls.

If Node is outside that range, stop and ask how the user wants to install/switch Node. The fork does not support the default Node 26 found on some newer systems.

## 2. Install this fork and Chromium

With authorization for user-level/global installation:

```sh
npm install -g 'git+https://github.com/gaktug/pomerado-obliterated.git#main'
npx -y -p playwright@1.63.0 playwright install chromium
pomerado-obliterated-mcp --help
command -v pomerado-obliterated-mcp
```

Pin `#main` to a tested commit SHA for reproducible installs. The Git install builds the package; the upstream npm package is never involved. If Chromium needs Linux libraries, ask before `npx -y -p playwright@1.63.0 playwright install --with-deps chromium` because it needs sudo. A network-blocked browser download is a blocker, not a pass.

## 3. Choose provider and integration folder

Ask where integrations should be saved (suggest an absolute path under the user's home), and which provider to use if not specified. Do not put a key value in the repo or a shared config. Configure **variable names and model IDs** for Z.ai Coding Plan:

```text
POMERADO_MODEL_BASE_URL=https://api.z.ai/api/coding/paas/v4
POMERADO_MODEL_API_KEY_ENV=GLM_API_KEY
POMERADO_MODEL_PROTOCOL=chat_completions
POMERADO_MINTER_MODEL=GLM-5.3
POMERADO_GUARDIAN_MODEL=GLM-5.3
POMERADO_OUTCOME_REVIEWER_MODEL=GLM-5.3
```

The user places `GLM_API_KEY` into their client's private environment. Other providers need their own URL, key-variable **name** and three model IDs. With no custom base URL the upstream OpenAI default requires `OPENAI_API_KEY` and access to its configured models. [Getting started](getting-started.md#another-model-provider) has the options.

## 4. Connect and verify

Use `command -v pomerado-obliterated-mcp` to get the installed executable's **absolute path**. Add it to the user's MCP client with `mint --root /absolute/path/to/integrations`. Set at least a 60-second tool-call timeout and forward every provider setting **and the key variable** using the client's documented environment mechanism. For example, a generic `mcpServers` entry is:

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

Client-specific commands and environment caveats are in [Getting started](getting-started.md#connect-an-mcp-client). Reload the client; verify `mint`, `get_job`, `provide_input` and `cancel_job` are visible. Listing tools incurs no model cost. An actual mint should be done only after the user approves the site/task and paid provider calls. For a read-only smoke, use https://www.iana.org/domains/reserved and its H1; do **not** use example.com, which may have no H1. Follow the one returned job ID with `get_job` until it reports `build: published`, then run its generated integration separately and check the output. A write mint can act on a live site during construction: do not use one for a smoke test.

An installed executable, visible tools, a published build and a separate run are distinct acceptance gates. Report which passed and which remain untested.
