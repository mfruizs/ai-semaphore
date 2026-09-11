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

## 1. Install the OpenDeck plugin

1. Copy the `streamdeck-plugin/com.aistatus.opendeck.sdPlugin/` folder (as is, including `node_modules/`) to the OpenDeck plugins folder:

   ```bash
   cp -r streamdeck-plugin/com.aistatus.opendeck.sdPlugin \
     ~/.config/opendeck/plugins/
   ```

   (For Flatpak it would be `~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/`.)

   **On Windows**, copy the folder to `%AppData%\opendeck\plugins\` instead. The manifest already includes `CodePathWin` pointing to `launch.bat` (included in the folder), which is what OpenDeck executes on that platform — you only need to have [Node.js 20+](https://nodejs.org) installed and ensure `node --version` works from any console. On Linux and macOS, `plugin.js` is used directly (via `CodePath` / `CodePathMac`, with its `#!/usr/bin/env node` shebang), so you don't need anything extra there.

2. Restart OpenDeck (or use `opendeck --reload-plugin com.aistatus.opendeck.sdPlugin` if your version supports it).

3. In the app, add the **"AI Semaphore"** action to a key on your Stream Deck Mini.

4. Verify that the status server responds:

   ```bash
   curl http://127.0.0.1:47663/status
   # {"claude":0,"opencode":0,"copilot":0,"codex":0,"port":47663}  -> 0=green, 1=yellow, 2=red
   ```

   On Windows (PowerShell): `Invoke-RestMethod http://127.0.0.1:47663/status`

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

- **Manual**: manually edit the number `47663` in each hooks file and in `ai-semaphore.ts`.
- **Using an environment variable**: export `AI_SEMAPHORE_PORT=<new_port>` in the shell from which you launch each tool (for example in your `~/.bashrc`/`~/.zshrc`). All files already read it if present, so you don't need to change anything else.

## 4. Connect Claude Code

Copy the contents of `claude-code-hooks/settings.snippet.json` into the `"hooks"` block of your `~/.claude/settings.json` (or `.claude/settings.json` in the project), replacing the three instances of `<YOUR_TOKEN>` with the copied token. If you already have configured hooks, add `UserPromptSubmit`, `Notification`, and `Stop` as sibling keys to the existing ones, instead of overwriting the entire file.

What each one does:
- `UserPromptSubmit` → yellow, as soon as you send it a task.
- `Notification` (matcher `permission_prompt`) → red, when it asks for permission.
- `Stop` → green, when it finishes responding.

## 5. Connect Copilot CLI

Copy `copilot-cli-hooks/ai-semaphore.json` to:

- `~/.copilot/hooks/ai-semaphore.json` so it applies to all your sessions (Linux/macOS; on Windows it is `%USERPROFILE%\.copilot\hooks\ai-semaphore.json`), or
- `.github/hooks/ai-semaphore.json` inside a specific project.

Replace the three instances of `<YOUR_TOKEN>` with the copied token.

What each one does:
- `userPromptSubmitted` → yellow, as soon as you send it a task.
- `permissionRequest` → red, when it asks for permission to execute a tool.
- `agentStop` → green, when the turn ends.

Copilot CLI automatically loads `.json` files from those folders at startup, no additional registration step is needed.

## 6. Connect Codex CLI

⚠️ The hook system in Codex CLI is **experimental** at this time: it is disabled by default and **is not available on Windows**. Enable it first by adding this to `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true
```

Then copy `codex-cli-hooks/hooks.json` to:

- `~/.codex/hooks.json` so it applies to all your sessions, or
- `<your_repo>/.codex/hooks.json` inside a specific project (following the Codex "untrusted project" trust model, just like the rest of the project configuration).

Replace the three instances of `<YOUR_TOKEN>` with the copied token.

What each one does:
- `UserPromptSubmit` → yellow, as soon as you send it a task.
- `PermissionRequest` → red, when it asks for permission to execute something.
- `Stop` → green, when the turn ends.

Note: `PermissionRequest` in Codex can also trigger for requests that are later auto-approved without you having to do anything (if you use the "approve for me" mode), so you might occasionally see a shorter than expected red flash. This is a known limitation of the hook itself, not the semaphore.

## 7. Connect OpenCode

Copy `opencode-plugin/ai-semaphore.ts` to:

- `~/.config/opencode/plugins/ai-semaphore.ts` so it applies to all your sessions, or
- `.opencode/plugins/ai-semaphore.ts` inside a specific project.

Inside the file, replace `<YOUR_TOKEN>` with the same token, or — more conveniently if you regenerate it often — leave that line as is and export `AI_SEMAPHORE_TOKEN` in the environment from which you launch OpenCode; the plugin uses it automatically if it is present.

OpenCode automatically loads `.ts`/`.js` files from those folders at startup, so there is no need to register it in `opencode.json`.

## Notes

- The `GET /status` endpoint (read-only, useful for debugging with `curl`) deliberately doesn't require a token: it only exposes what color is set on each source and the active port; it doesn't allow changing anything.
- If you want to bypass the Property Inspector flow (for example, to start OpenDeck from a script), you can set the token and/or port yourself using the `AI_SEMAPHORE_TOKEN` and `AI_SEMAPHORE_PORT` environment variables before launching it; the plugin uses these instead of what is saved in the Property Inspector.
- The `Stop`/`agentStop` hook of each tool triggers every time it finishes responding, not only upon completing a long multi-turn task; for your use case (knowing when you can send it something new) this is exactly what is needed.