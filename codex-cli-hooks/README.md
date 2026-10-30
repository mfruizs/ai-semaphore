# Codex CLI → AI Semaphore

Install `hooks.json`, `ai-semaphore-event.py` and `ai-semaphore-hook.sh` together
(Python 3.9+, Bash and curl required). Configure
`AI_SEMAPHORE_TOKEN` or replace `<YOUR_TOKEN>` in the script, then review the
definitions with `/hooks` in Codex.

`PreToolUse` detects both `request_user_input` and `request_user_input_async`.
The Python helper keeps pending questions red across unrelated tool completions
and the async tool's immediate acknowledgement. The next `UserPromptSubmit`,
interruption or session reset clears async questions; blocking questions clear
when their tool returns. Replace old semaphore handlers when upgrading so they
cannot overwrite the pending state. Keep unrelated hooks and the configured token.

Full installation, event mappings and troubleshooting:

- [English](../README.md#6-connect-codex-cli)
- [Español](../README_ES.md#6-conectar-codex-cli)

Notification failures are recorded in
`${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore/codex-hook.log`. The hook always
returns exit code 0 with empty stdout so notification errors do not block Codex.

Run the server and hook regression tests from the repository root:

```bash
npm test --prefix streamdeck-plugin/com.aistatus.opendeck.sdPlugin
```
