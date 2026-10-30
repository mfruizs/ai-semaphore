#!/usr/bin/env python3
"""Map Codex lifecycle events to colors, preserving unanswered questions."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


COLORS = {
    "SessionStart": "green", "UserPromptSubmit": "yellow",
    "PreToolUse": "red", "PermissionRequest": "red",
    "PostToolUse": "yellow", "Stop": "green",
    "Interrupt": "green", "SessionEnd": "green",
}
QUESTIONS = {"request_user_input", "request_user_input_async"}
RESETS = {"SessionStart", "UserPromptSubmit", "Interrupt", "SessionEnd"}
CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "ai-semaphore"


def notify(color):
    subprocess.run(
        ["bash", str(Path(__file__).with_name("ai-semaphore-hook.sh")), color],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=2.5, check=False,
    )


def transition(event, pending):
    name = event["hook_event_name"]
    tool = event.get("tool_name", "").removeprefix("functions.")
    call = event.get("tool_use_id")
    if name in RESETS:
        pending.clear()
    elif name == "PreToolUse":
        if tool not in QUESTIONS:
            return None
        if isinstance(call, str) and call:
            pending[call] = tool
    elif name == "PostToolUse":
        response = event.get("tool_response")
        if isinstance(response, str):
            try:
                response = json.loads(response)
            except ValueError:
                response = None
        # The async tool returns {accepted: true} immediately, before the reply.
        # That completion (and unrelated tools) must not clear the red light.
        accepted = isinstance(response, dict) and response.get("accepted") is True
        if tool == "request_user_input" or (tool == "request_user_input_async" and not accepted):
            pending.pop(call, None)
    return "red" if pending else COLORS[name]


def main():
    event = json.load(sys.stdin)
    if not isinstance(event, dict) or event.get("hook_event_name") not in COLORS:
        return
    session = event.get("session_id")
    if not isinstance(session, str) or not session:
        return
    directory = CACHE / "codex-pending"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # No prompts, options, answers, tokens or raw session ids are persisted.
    key = hashlib.sha256(session.encode()).hexdigest()
    fd = os.open(directory / (key + ".json"), os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, "r+") as state:
        deadline = time.monotonic() + 0.25
        while True:
            try:
                fcntl.flock(state, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("state lock")
                time.sleep(0.01)
        contents = state.read()
        pending = json.loads(contents) if contents else {}
        if not isinstance(pending, dict):
            pending = {}
        color = transition(event, pending)
        state.seek(0)
        json.dump(pending, state)
        state.truncate()
        state.flush()
        # Keep the lock through delivery so concurrent hooks cannot reorder colors.
        if color:
            notify(color)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Like the Bash notifier, never block Codex or expose hook input.
        try:
            CACHE.mkdir(mode=0o700, parents=True, exist_ok=True)
            with (CACHE / "codex-hook.log").open("a") as log:
                log.write(f"Codex event notification failed: {type(error).__name__}\n")
        except OSError:
            pass
