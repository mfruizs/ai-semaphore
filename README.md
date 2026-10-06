# AI Semaphore — status semaphore for Claude Code, Copilot CLI, Codex CLI and OpenCode on OpenDeck

[Spanish](README_ES.md)

<p align="center">
  <img src="docs/pluginIcon.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:200px; height:200px">
  <br>
{  <img src="docs/state-red.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:50px; height:50px">
   <img src="docs/state-yellow.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:50px; height:50px">
   <img src="docs/state-green.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:50px; height:50px">}
  <br>
</p>

A single key on your Stream Deck Mini that combines the status of **Claude Code**, **GitHub Copilot CLI**, **OpenAI Codex CLI**, and **OpenCode**:

- 🔴 **Red** — any of the four is waiting for your confirmation/permission.
- 🟡 **Yellow** — any of them is working (and none are red).
- 🟢 **Green** — all four are ready for a new task.

Priority when combining: **red > yellow > green** (if one asks for confirmation, red overrides even if another is working).

Pressing the key displays tool-specific details for 3 seconds (`C:` Claude, `O:` OpenCode, `G:` GitHub Copilot, `X:` Codex) in case you want to know which of the four is in that state.

## Pieces

```text
streamdeck-plugin/    -> the OpenDeck plugin (the key + the local status server)
claude-code-hooks/    -> hooks for Claude Code to notify the semaphore
copilot-cli-hooks/    -> hooks for Copilot CLI to notify the semaphore
codex-cli-hooks/      -> hooks for Codex CLI to notify the semaphore
opencode-plugin/      -> OpenCode plugin to notify the semaphore
```

Everything communicates via HTTP on `127.0.0.1:47663` (configurable). The OpenDeck plugin itself spins up this server — no additional running process is needed.

## 1. Install or update the OpenDeck plugin

### Automatic install/update on Linux

From the repository root, after downloading the version you want to install:

```bash
python3 scripts/update-opendeck-plugin.py --dry-run  # preview only
python3 scripts/update-opendeck-plugin.py            # install and restart
```

Run it as your regular user, **without sudo**. It requires Python 3.8+, Node.js 20+
and the `opendeck` launcher in PATH. For the Flatpak installation:

```bash
python3 scripts/update-opendeck-plugin.py --flatpak
```

For a custom plugins location, add `--plugins-dir /path/to/opendeck/plugins`.
The script resolves its source from its own location, so it can also be run
from another directory using its full path.

The updater:

1. Validates the plugin files and bundled `node_modules` before stopping anything.
2. Closes OpenDeck completely and stops surviving AI Semaphore processes,
   including old copies moved to Trash. It only targets this plugin's exact UUID;
   it does not stop unrelated Node processes or use a forced kill.
3. Moves the previous plugin into a backup outside the `plugins` directory and
   installs the complete new folder. If the folder swap fails, it restores the
   previous folder.
4. Restarts OpenDeck and verifies that the new plugin process owns the configured
   status port, runs from the installed directory, and serves all four sources.

**Restarting here means restarting OpenDeck and the plugin.** It preserves
profiles, assigned keys, the saved token and port, and installed CLI hooks.
The in-memory colors start green until the integrations send their next events.
There is no need to regenerate the token, reset the device, or re-add the action.
On first installation, add the AI Semaphore action to a key after the restart.

The script prints the backup location under OpenDeck's `plugin-backups/` folder.
Keep backups outside `plugins/` so OpenDeck does not discover an old copy.
Restart diagnostics go to
`${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore/opendeck-update.log`.
If verification fails, the command exits with an error: check that log, the
OpenDeck plugin logs and the port configured in the Property Inspector.
The native Linux path has been tested; use `--dry-run` to check your Flatpak
or custom installation before updating.

### Manual installation (including Windows/macOS)

Before replacing an existing installation, follow the update checklist below.

1. Copy the `streamdeck-plugin/com.aistatus.opendeck.sdPlugin/` folder (as is, including `node_modules/`) to the OpenDeck plugins folder:

   ```bash
   cp -r streamdeck-plugin/com.aistatus.opendeck.sdPlugin \
     ~/.config/opendeck/plugins/
   ```

   (For Flatpak it would be `~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/`.)

   **On Windows**, copy the folder to `%AppData%\opendeck\plugins\` instead. The manifest already includes `CodePathWin` pointing to `launch.bat` (included in the folder), which is what OpenDeck executes on that platform — you only need to have [Node.js 20+](https://nodejs.org) installed and ensure `node --version` works from any console. On Linux and macOS, `plugin.js` is used directly (via `CodePath` / `CodePathMac`, with its `#!/usr/bin/env node` shebang), so you don't need anything extra there.
<p align="center">
  <img src="docs/ia-semaphore-icon.png" alt="AI Semaphore appearance in the OpenDeck interface">
  <br>
  <em>This is how the semaphore looks in the green (ready) state once assigned to a key on your Stream Deck Mini.</em>
</p>

2. Fully exit OpenDeck, including its background/tray process, then start it again. Merely resetting the key or replacing the files does not reload an already running plugin.

<p align="center">
  <img src="docs/ia-semaphore-config.png" alt="Property Inspector configuration panel">
  <br>
  <em>From the property panel, you can copy your unique security token or modify the default port if you run into any conflicts.</em>
</p>

3. In the app, add the **"AI Semaphore"** action to a key on your Stream Deck Mini.

4. Verify that the status server responds:

   ```bash
   curl http://127.0.0.1:47663/status
   # {"claude":0,"opencode":0,"copilot":0,"codex":0,"port":47663}  -> 0=green, 1=yellow, 2=red
   ```

   On Windows (PowerShell): `Invoke-RestMethod http://127.0.0.1:47663/status`

### Manual update and troubleshooting

1. Fully exit OpenDeck before copying the updated plugin. Closing its window
   can leave the app running in the background.
2. Check for surviving AI Semaphore processes and stop only those identified
   by `-pluginUUID com.aistatus.opendeck.sdPlugin`. Moving the old folder to Trash
   does not stop its process. On Linux, the updater above handles this for you.
3. Back up the previous plugin outside the plugins directory, then replace the
   installed folder with the new one, including `node_modules`. Keep the separate
   OpenDeck `settings/` and `profiles/` directories.
4. Start OpenDeck again and verify the server, using your configured port:

   ```bash
   curl "http://127.0.0.1:${AI_SEMAPHORE_PORT:-47663}/status"
   ```

   The result must include **`claude`, `opencode`, `copilot` and `codex`**.
   If only Claude/OpenCode appear, an older version is serving the port.
   A hook log entry with `HTTP 404` for `/status/codex` can indicate the same issue.
   A `401` points to the authentication token instead.
5. On Linux, identify the listener if there is still a conflict:

   ```bash
   ss -ltnp 'sport = :47663'
   ```

   Use the PID shown to inspect `/proc/<PID>/cwd`; it should be the installed
   `com.aistatus.opendeck.sdPlugin` directory, never an old copy in Trash.
   Adjust `47663` if you changed the port. Do not kill an unrelated service
   using that port: choose another port in OpenDeck and update your integrations.

## 2. Copy the authentication token

The plugin's local server only listens on `127.0.0.1`, but that isn't enough: any other process on your machine (or a browser tab, which can send "simple" POST requests to `localhost` without triggering CORS) could send a POST request and spoof the semaphore. Because of this, requests that change the state require a token.

The first time the plugin starts, it generates a random token and saves it. To view it:

1. In OpenDeck, click on the "AI Semaphore" key to open its configuration panel (the Property Inspector).
2. You will see the **"Semaphore authentication token"** field with two buttons: **Copy** and **Regenerate**.
3. Copy it — you'll need it in the connection steps below.

If you ever suspect it has been leaked, click **Regenerate** and update it in all the locations below (the previous one will immediately stop working).

## 3. (Optional) Change the port

By default, everything uses `47663`. If this conflicts with something else on your machine, in the same Property Inspector panel you will see the **"Local server port"** field with a **Save port** button — upon saving, the plugin immediately restarts its server there, without requiring an OpenDeck restart.

Keep in mind: the other consumers (the Claude, Copilot, and Codex hooks, and the OpenCode plugin) won't automatically find out about the change. You have two ways to keep them synchronized:

- **Manual**: manually edit the number `47663` in the Claude/Copilot hooks, in `ai-semaphore-hook.sh` for Codex, and in `ai-semaphore.ts`.
- **Using an environment variable**: export `AI_SEMAPHORE_PORT=<new_port>` in the shell from which you launch each tool (for example in your `~/.bashrc`/`~/.zshrc`). All files already read it if present, so you don't need to change anything else.

## 4. Connect Claude Code

This integration uses Bash and curl (Linux/macOS). Install the script:

```bash
mkdir -p ~/.claude
cp claude-code-hooks/ai-semaphore-hook.sh ~/.claude/ai-semaphore-hook.sh
chmod +x ~/.claude/ai-semaphore-hook.sh
```

Open the installed script and replace `<YOUR_TOKEN>` **only in the assignment
`TOKEN='<YOUR_TOKEN>'`** with the token copied from OpenDeck's panel. The token
is configured manually; `AI_SEMAPHORE_TOKEN` does not override it. Make sure
`PORT` matches the panel's port (default `47663`).

Merge the `hooks` object from `claude-code-hooks/settings.snippet.json` into
`~/.claude/settings.json` (or the project's `.claude/settings.json`). The snippet
already contains the root `hooks` object: do not nest it inside another `hooks`.
Keep existing settings and hooks; append our entries to the event array when
an event already exists. Commands use the script in `$HOME/.claude/` even for
project configuration. Restart the Claude session to load the hooks.

| Event | State |
| --- | --- |
| `SessionStart` (startup/resume/clear/fork) | Green |
| `UserPromptSubmit`, `PreToolUse` | Yellow |
| `PermissionRequest` | Red immediately when requesting permission |
| `Notification` (`permission_prompt` only) | Red; also covers network permission notifications |
| `PostToolUse`, `PostToolUseFailure` | Yellow when resuming after a tool |
| `Stop`, `StopFailure`, `SessionEnd` | Green |

`PermissionRequest` avoids waiting for the permission notification. Compaction
and idle notifications do not reset the semaphore.
Reference: [Claude Code hooks](https://code.claude.com/docs/en/hooks).

## 5. Connect Copilot CLI

This integration uses Bash and curl (Linux/macOS). Install the script and
global configuration:

```bash
mkdir -p ~/.copilot/hooks
cp copilot-cli-hooks/ai-semaphore-hook.sh ~/.copilot/ai-semaphore-hook.sh
chmod +x ~/.copilot/ai-semaphore-hook.sh
cp copilot-cli-hooks/ai-semaphore.json ~/.copilot/hooks/ai-semaphore.json
```

Open the installed script and replace `<YOUR_TOKEN>` **only in the assignment
`TOKEN='<YOUR_TOKEN>'`** with the same OpenDeck token. `AI_SEMAPHORE_TOKEN` does
not override it. For another port, edit `PORT` or export `AI_SEMAPHORE_PORT`
before launching Copilot.

For project-only hooks, copy the JSON to `.github/hooks/ai-semaphore.json`
instead of the global folder; commands still use `$HOME/.copilot/` for the
script. Copilot CLI loads the JSON files at startup. Keep existing hooks and
restart Copilot after installation. The included JSON defines `bash` commands;
native Windows needs a PowerShell implementation and `powershell` entries.

| Event | State |
| --- | --- |
| `sessionStart` | Green |
| `userPromptSubmitted`, `preToolUse` | Yellow |
| `permissionRequest` | Red |
| `postToolUse`, `postToolUseFailure` | Yellow when resuming after a tool |
| `agentStop`, `errorOccurred`, `sessionEnd` | Green |

Copilot's `permissionRequest` fires before permission evaluation, including
automatic approvals: a brief red flash can occur without asking the user.
These hooks return no permission decisions. This integration is for the local
CLI; the cloud agent cannot reach OpenDeck on your machine.
Reference: [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).

Test either installed script from the same environment:

```bash
~/.claude/ai-semaphore-hook.sh yellow  # or ~/.copilot/ai-semaphore-hook.sh
curl "http://127.0.0.1:${AI_SEMAPHORE_PORT:-47663}/status"
~/.claude/ai-semaphore-hook.sh red
~/.claude/ai-semaphore-hook.sh green
```

The `claude` (or `copilot`) field should change to `1`, `2`, then `0`. Requests
use the manual token, a direct connection to `127.0.0.1`, and a two-second
timeout. Scripts exit with code `0` and empty output even if the semaphore
fails. Check `${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore/claude-hook.log` or
`copilot-hook.log`: `401` means wrong token; `204` means the state was applied.
Logs contain no tokens. After regenerating the token, update the `TOKEN`
assignment in every installed script. Sessions of the same AI share one state.

If `/status` does not include `copilot` and `codex`, update the OpenDeck plugin
from this repository's folder and restart OpenDeck to load that version.

## 6. Connect Codex CLI

The supplied integration needs Bash and curl (Linux/macOS, or an environment
with both tools installed). See the [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks)
for version-specific availability. Recent Codex versions enable hooks by default;
if needed, enable them in the existing `[features]` section of `~/.codex/config.toml`:

```toml
[features]
hooks = true
```

Install both files:

```bash
mkdir -p ~/.codex
cp codex-cli-hooks/ai-semaphore-hook.sh ~/.codex/ai-semaphore-hook.sh
chmod +x ~/.codex/ai-semaphore-hook.sh
cp codex-cli-hooks/hooks.json ~/.codex/hooks.json
```

If you already have hooks, merge the event entries into the existing `hooks`
object instead of overwriting the file. For project-only use, put `hooks.json`
in `<your_repo>/.codex/` instead; the project must be trusted. The supplied
commands still use the script in `$HOME/.codex/`, independently of the session's
working directory. If you use a custom `CODEX_HOME`, adjust the installation
paths and hook commands accordingly.

Configure the token **manually once**: replace `<YOUR_TOKEN>` in the installed
`ai-semaphore-hook.sh` token assignment with the token from OpenDeck's panel.
`hooks.json` contains no token. Edit `PORT` if you changed the panel's port.
This script also supports `AI_SEMAPHORE_TOKEN` and `AI_SEMAPHORE_PORT`; exported
values take priority over the script's manual values.

Start Codex and open `/hooks` to review and trust the new or changed definitions.
Codex skips untrusted hooks. Changing the token in the script or environment
keeps the hook commands unchanged; editing `hooks.json` requires review again.

| Event | State |
| --- | --- |
| `SessionStart` (startup/resume/clear) | Green |
| `UserPromptSubmit` | Yellow |
| `PermissionRequest` | Red |
| `PostToolUse` | Yellow, restoring the working state after a permission |
| `Stop`, `Interrupt`, `SessionEnd` | Green |

Compaction does not reset the semaphore. `PermissionRequest` only marks red
when Codex requests approval; with `approval_policy = "never"`, do not expect
that flow. Automatic approvals may produce a brief red flash. Each source
stores one state, so concurrent sessions of the same tool overwrite each other.

Test the connection without Codex, from the same environment:

```bash
~/.codex/ai-semaphore-hook.sh yellow
curl "http://127.0.0.1:${AI_SEMAPHORE_PORT:-47663}/status"
~/.codex/ai-semaphore-hook.sh red
~/.codex/ai-semaphore-hook.sh green
```

The `codex` value should change to `1`, `2`, then `0`. The script deliberately
exits with code `0` and empty stdout, even on failure, so a semaphore failure
does not block Codex. Check `${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore/codex-hook.log`
for missing tokens, invalid configuration, curl failures, or unexpected HTTP
responses. `401` means a missing/wrong token; `400` means invalid JSON/state;
`204` means the server applied the state. Requests time out after two seconds.
The log never includes the token or server response body.

## 7. Connect OpenCode

Copy `opencode-plugin/ai-semaphore.ts` to:

- `~/.config/opencode/plugins/ai-semaphore.ts` so it applies to all your sessions, or
- `.opencode/plugins/ai-semaphore.ts` inside a specific project.

Inside the file, replace `<YOUR_TOKEN>` with the same token, or — more conveniently if you regenerate it often — leave that line as is and export `AI_SEMAPHORE_TOKEN` in the environment from which you launch OpenCode; the plugin uses it automatically if it is present.

OpenCode automatically loads `.ts`/`.js` files from those folders at startup, so there is no need to register it in `opencode.json`.

## Notes

- The `GET /status` endpoint (read-only, useful for debugging with `curl`) deliberately doesn't require a token: it only exposes what color is set on each source and the active port; it doesn't allow changing anything.
- If you want to bypass the Property Inspector flow (for example, to start OpenDeck from a script), you can set the token and/or port yourself using the `AI_SEMAPHORE_TOKEN` and `AI_SEMAPHORE_PORT` environment variables before launching it; the plugin uses these instead of what is saved in the Property Inspector. While these environment overrides are set, changes saved in the Property Inspector do not change the active token/port; update the environment and restart OpenDeck, or remove the overrides to use saved settings.
- The `Stop`/`agentStop` hook of each tool triggers every time it finishes responding, not only upon completing a long multi-turn task; for your use case (knowing when you can send it something new) this is exactly what is needed.
