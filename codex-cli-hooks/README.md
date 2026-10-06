# Codex CLI → AI Semaphore

Install `hooks.json` and `ai-semaphore-hook.sh` together. Configure
`AI_SEMAPHORE_TOKEN` or replace `<YOUR_TOKEN>` in the script, then review the
definitions with `/hooks` in Codex.

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
