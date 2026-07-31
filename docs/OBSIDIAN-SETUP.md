# Obsidian MCP setup

The repository config at `.mcp.json` connects directly to Obsidian's native MCP
endpoint. The API key stays in `SHERMAN_OBSIDIAN_API_KEY`; never paste it into a
tracked file.

## 1. Open the Sherman vault

1. Open Obsidian.
2. Choose **Open folder as vault**.
3. Select the `vault/` directory inside your sherman clone
   (for example `~/code/sherman/vault`).
4. Confirm that Obsidian shows the Sherman `wiki`, `inbox`, and `memory`
   folders.

The vault is plain Markdown in the repo, so no export step exists or is
needed — what Obsidian edits is what Sherman reads. `sherman sync` is what
moves the shared lanes (wiki, shared memory, inbox) between machines;
private memory stays on the machine that wrote it.

## 2. Install the local MCP plugin

1. Open **Settings → Community plugins**.
2. If Community plugins are restricted, choose **Turn on community plugins**.
3. Choose **Browse**, search for **Local REST API with MCP**, and select the
   plugin by Adam Coddington (`coddingtonbear`).
4. Choose **Install**, then **Enable**.
5. Open **Settings → Local REST API with MCP**.
6. Turn on **Enable non-encrypted (HTTP) server**.
7. Leave **Non-encrypted (HTTP) server port** at `27123`. Do not expose this
   loopback service to the network or internet.
8. Under **How to access via MCP**, confirm the enabled endpoint is
   `http://127.0.0.1:27123/mcp/`.

The HTTP endpoint matches Evan's second-brain setup. It is acceptable here only
because it is loopback-only and still requires the plugin API key. Obsidian
must remain open for the server to be available.

## 3. Put the API key in the environment

1. In the plugin settings, copy the API key shown above the access examples.
   Copy the key itself, not the displayed `Bearer ` prefix.
2. In the terminal that will launch Claude Code, set:

   ```sh
   export SHERMAN_OBSIDIAN_API_KEY='<paste the Obsidian API key here>'
   ```

3. Confirm that the variable exists without printing the secret:

   ```sh
   test -n "$SHERMAN_OBSIDIAN_API_KEY" && echo "Sherman Obsidian key is set"
   ```

For persistence across new terminal windows, put that `export` in a private
shell startup file such as `~/.zshrc`, then open a new terminal. Never put the
literal key in `.mcp.json`, this repository, the vault, a commit, or chat.

## 4. Approve and verify the project servers

1. Keep Obsidian open on the Sherman vault.
2. Start a fresh terminal after setting the variable.
3. Run:

   ```sh
   cd <your sherman clone>
   claude mcp list
   ```

4. Launch `claude` from that directory. Approve the two project-scoped
   `.mcp.json` servers when Claude Code asks.
5. Run `/mcp` and confirm `sherman-obsidian` is connected.
6. Ask Claude to list the vault root with the Obsidian `vault_list` tool; the
   result should include `wiki`, `inbox`, and `memory`.

If `sherman-obsidian` is unreachable, check that Obsidian is open, this exact
vault is active, the plugin is enabled, the HTTP toggle is on, port `27123` is
unchanged, and the environment variable is present in the process that launched
Claude.

The `sherman-graphify` server in the same `.mcp.json` becomes available after a
local graph exists at `graphify-out/graph.json`. Generate or refresh it from the
repo root with `graphify update .`; its output is local and must never be
committed. The Sherman-specific server names deliberately avoid collisions with
Evan's existing user-scoped Obsidian and graphify servers.

## 5. Configure Codex

Codex reads MCP servers from `~/.codex/config.toml`, not `.mcp.json`. Do not
put the API key in the TOML and do not edit the file from an automated setup
step. Evan can copy and paste this block:

```toml
[mcp_servers.sherman-obsidian]
url = "http://127.0.0.1:27123/mcp/"
bearer_token_env_var = "SHERMAN_OBSIDIAN_API_KEY"
```

If `[mcp_servers.sherman-obsidian]` already exists, replace that table instead
of adding a duplicate; duplicate TOML tables are invalid. Leave the existing
generic `[mcp_servers.obsidian]` table and every unrelated Codex setting
unchanged.

After saving, start Codex from a fresh terminal that has
`SHERMAN_OBSIDIAN_API_KEY` set. Run `codex mcp list`, then `/mcp` inside Codex,
and confirm that `sherman-obsidian` is connected.
