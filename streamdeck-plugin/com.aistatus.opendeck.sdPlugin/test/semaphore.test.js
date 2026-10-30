"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const runFile = promisify(execFile);
const pluginDir = path.resolve(__dirname, "..");
const hooksDir = path.resolve(pluginDir, "../../codex-cli-hooks");

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 1;
  messages = [];
  send(message) { this.messages.push(JSON.parse(message)); }
}

// Run the actual plugin with a fake OpenDeck connection and a real HTTP server
// on an OS-selected port. No installed hooks, OpenDeck settings or token change.
async function loadPlugin(env) {
  let server;
  const context = vm.createContext({
    require(name) {
      if (name === "ws") return FakeWebSocket;
      if (name === "http") return {
        createServer(handler) {
          server = http.createServer(handler);
          const listen = server.listen.bind(server);
          server.listen = () => listen(0, "127.0.0.1");
          return server;
        },
      };
      return require(name);
    },
    process: { argv: ["node", "plugin.js", "-port", "12345", "-pluginUUID", "test", "-registerEvent", "registerPlugin"], env },
    Buffer, setTimeout,
  });
  vm.runInContext(await fs.readFile(path.join(pluginDir, "plugin.js"), "utf8"), context);
  await once(server, "listening");
  const socket = vm.runInContext("ws", context);
  socket.emit("open");
  return { context, server, socket, url: `http://127.0.0.1:${server.address().port}` };
}

test("HTTP validation, authentication, state priority and Codex hook", async (t) => {
  const token = "test-env-token";
  const plugin = await loadPlugin({ AI_SEMAPHORE_TOKEN: token, AI_SEMAPHORE_PORT: "47663" });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-semaphore-test-"));
  t.after(async () => {
    plugin.server.closeAllConnections();
    await new Promise(resolve => plugin.server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const post = (body, auth = token, source = "codex") => fetch(`${plugin.url}/status/${source}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }) },
    body,
  });
  const status = async () => (await fetch(`${plugin.url}/status`)).json();
  const lastState = () => plugin.socket.messages.filter(m => m.event === "setState").at(-1).payload.state;
  plugin.socket.emit("message", JSON.stringify({ event: "willAppear", context: "key" }));

  await t.test("environment token takes priority over persisted settings", async () => {
    vm.runInContext('handleGlobalSettings({token: "saved-token", port: 47663})', plugin.context);
    assert.equal((await post('{"state":"yellow"}', "saved-token")).status, 401);
    assert.equal((await post('{"state":"yellow"}')).status, 204);
    assert.equal((await status()).codex, 1);
  });

  await t.test("missing or wrong bearer cannot change state", async () => {
    for (const auth of [null, "wrong-token", "<YOUR_TOKEN>"]) {
      assert.equal((await post('{"state":"green"}', auth)).status, 401);
      assert.equal((await status()).codex, 1);
    }
  });

  await t.test("malformed JSON and invalid states fail without changing state", async () => {
    for (const body of ["", "{", "null", '"red"', "[]", "{}", '{"state":null}', '{"state":1}', '{"state":["red"]}', '{"state":"purple"}', '{"state":"toString"}']) {
      const response = await post(body);
      assert.equal(response.status, 400, body);
      assert.match((await response.json()).error, /^invalid_(json|state)$/);
      assert.equal((await status()).codex, 1);
    }
  });

  await t.test("oversized payload is rejected", async () => {
    assert.equal((await post(JSON.stringify({ state: "red", padding: "x".repeat(4096) }))).status, 413);
    assert.equal((await status()).codex, 1);
  });

  await t.test("all four sources combine with red > yellow > green", async () => {
    for (const source of ["claude", "opencode", "copilot", "codex"]) {
      const response = await post('{"state":"green"}', token, source);
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
    }
    assert.equal(lastState(), 0);
    await post('{"state":"yellow"}', token, "codex");
    assert.equal(lastState(), 1);
    await post('{"state":"red"}', token, "claude");
    assert.equal(lastState(), 2);
    await post('{"state":"green"}', token, "claude");
    assert.equal(lastState(), 1);
    await post('{"state":"green"}', token, "codex");
    assert.equal(lastState(), 0);
    assert.equal((await fetch(`${plugin.url}/status/unknown`)).status, 404);
  });

  const script = path.join(hooksDir, "ai-semaphore-hook.sh");
  const log = path.join(temp, "ai-semaphore/codex-hook.log");
  const scriptEnv = { ...process.env, AI_SEMAPHORE_TOKEN: token, AI_SEMAPHORE_PORT: String(plugin.server.address().port), XDG_CACHE_HOME: temp };
  const invoke = async (state, overrides = {}, file = script) => {
    const result = await runFile("bash", [file, state], { env: { ...scriptEnv, ...overrides }, timeout: 4500 });
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  };

  await t.test("actual Bash/curl hook applies yellow, red and green", async () => {
    for (const [color, index] of [["yellow", 1], ["red", 2], ["green", 0]]) {
      await invoke(color);
      assert.equal((await status()).codex, index);
    }
    await assert.rejects(fs.access(log), { code: "ENOENT" });
  });

  await t.test("hook supports inline fallback and environment override", async () => {
    const fallback = path.join(temp, "fallback.sh");
    await fs.writeFile(fallback, (await fs.readFile(script, "utf8")).replace(':-<YOUR_TOKEN>', ':-test-env-token'));
    await invoke("yellow", { AI_SEMAPHORE_TOKEN: "" }, fallback);
    assert.equal((await status()).codex, 1);
    await invoke("red", { AI_SEMAPHORE_TOKEN: "wrong-token" }, fallback);
    assert.equal((await status()).codex, 1);
    assert.match(await fs.readFile(log, "utf8"), /HTTP 401/);
  });

  await t.test("bad configuration is logged and never blocks Codex", async () => {
    await invoke("invalid");
    await invoke("green", { AI_SEMAPHORE_TOKEN: "" });
    for (const port of ["0", "65536", "47663oops", "-1", "1.5", "999999999999999"]) {
      await invoke("green", { AI_SEMAPHORE_PORT: port });
    }
    for (const invalidToken of ["a\nb", "a\rb", "a b", "é"]) {
      await invoke("green", { AI_SEMAPHORE_TOKEN: invalidToken });
    }
    const contents = await fs.readFile(log, "utf8");
    assert.match(contents, /Invalid state/);
    assert.match(contents, /token not configured/);
    assert.match(contents, /Invalid AI_SEMAPHORE_PORT/);
    assert.match(contents, /Invalid AI Semaphore token format/);
    assert.equal((await status()).codex, 1);
    assert.ok(!contents.includes(token));
    assert.ok(!contents.includes("wrong-token"));
  });

  await t.test("HTTP failures and curl timeout are recorded", async () => {
    const fakeCurlDir = path.join(temp, "bin");
    await fs.mkdir(fakeCurlDir);
    for (const [output, exitCode, expected] of [["400", 0, /HTTP 400/], ["000", 28, /curl exit=28/]]) {
      await fs.writeFile(path.join(fakeCurlDir, "curl"), `#!/bin/sh\nprintf '${output}'\nexit ${exitCode}\n`, { mode: 0o700 });
      await invoke("green", { PATH: `${fakeCurlDir}:${process.env.PATH}` });
      assert.match(await fs.readFile(log, "utf8"), expected);
    }
  });

  await t.test("unavailable server is logged without blocking", async () => {
    const unavailable = http.createServer();
    unavailable.listen(0, "127.0.0.1");
    await once(unavailable, "listening");
    const port = unavailable.address().port;
    await new Promise(resolve => unavailable.close(resolve));
    await invoke("green", { AI_SEMAPHORE_PORT: String(port) });
    assert.match(await fs.readFile(log, "utf8"), /curl exit=7/);
  });

  await t.test("a stalled server is bounded by the real curl timeout", async () => {
    const stalled = http.createServer(req => req.resume());
    stalled.listen(0, "127.0.0.1");
    await once(stalled, "listening");
    try {
      const started = Date.now();
      await invoke("green", { AI_SEMAPHORE_PORT: String(stalled.address().port) });
      assert.ok(Date.now() - started < 3000);
      assert.match(await fs.readFile(log, "utf8"), /curl exit=28/);
    } finally {
      stalled.closeAllConnections();
      await new Promise(resolve => stalled.close(resolve));
    }
  });

  await t.test("unwritable logging does not prevent notification", async () => {
    const blocked = path.join(temp, "not-a-directory");
    await fs.writeFile(blocked, "");
    await invoke("green", { XDG_CACHE_HOME: blocked });
    assert.equal((await status()).codex, 0);
  });

  await t.test("hook commands are token-free and compact does not reset green", async () => {
    const config = JSON.parse(await fs.readFile(path.join(hooksDir, "hooks.json"), "utf8"));
    const expected = { SessionStart: "green", UserPromptSubmit: "yellow", PreToolUse: "red", PermissionRequest: "red", PostToolUse: "yellow", Stop: "green", Interrupt: "green", SessionEnd: "green" };
    assert.deepEqual(Object.keys(config.hooks).sort(), Object.keys(expected).sort());
    for (const [event, state] of Object.entries(expected)) {
      const handler = config.hooks[event][0].hooks[0];
      assert.equal(handler.command, 'python3 "$HOME/.codex/ai-semaphore-event.py"');
      assert.equal(handler.timeout, ["Interrupt", "SessionEnd"].includes(event) ? 3 : 5);
    }
    const matcher = new RegExp(config.hooks.SessionStart[0].matcher);
    for (const source of ["startup", "resume", "clear"]) assert.ok(matcher.test(source));
    assert.ok(!matcher.test("compact"));
  });
});

test("Codex questions keep the icon red until a reply or cancellation", async (t) => {
  const plugin = await loadPlugin({ AI_SEMAPHORE_TOKEN: "question-test-token" });
  plugin.socket.emit("message", JSON.stringify({ event: "willAppear", context: "key" }));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-questions-"));
  t.after(async () => {
    plugin.server.closeAllConnections();
    await new Promise(resolve => plugin.server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const installed = path.join(temp, ".codex");
  await fs.mkdir(installed);
  for (const name of ["ai-semaphore-hook.sh", "ai-semaphore-event.py"]) {
    await fs.copyFile(path.join(hooksDir, name), path.join(installed, name));
  }
  const config = JSON.parse(await fs.readFile(path.join(hooksDir, "hooks.json"), "utf8"));
  const env = {
    ...process.env, HOME: temp, XDG_CACHE_HOME: temp,
    AI_SEMAPHORE_TOKEN: "question-test-token",
    AI_SEMAPHORE_PORT: String(plugin.server.address().port),
  };
  const invoke = async (event, fields, expectedState) => {
    const value = event === "SessionStart" ? fields.source : fields.tool_name || "";
    const groups = config.hooks[event].filter(group => !group.matcher || new RegExp(group.matcher).test(value));
    assert.equal(groups.length, 1, `${event}:${value}`);
    const result = await new Promise((resolve, reject) => {
      const child = execFile("bash", ["-c", groups[0].hooks[0].command], { env, cwd: temp, timeout: 4500 },
        (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
      child.stdin.on("error", error => { if (error.code !== "EPIPE") reject(error); });
      child.stdin.end(JSON.stringify({
        hook_event_name: event, session_id: "test-session", tool_use_id: "question-1",
        tool_input: { private: "never-persist-this-question" }, ...fields,
      }));
    });
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal((await (await fetch(`${plugin.url}/status`)).json()).codex, expectedState);
    assert.equal(plugin.socket.messages.filter(m => m.event === "setState").at(-1).payload.state, expectedState);
  };

  await invoke("SessionStart", { source: "startup" }, 0);
  await invoke("UserPromptSubmit", {}, 1);
  await invoke("PermissionRequest", { tool_name: "Bash" }, 2);
  await invoke("PostToolUse", { tool_name: "Bash" }, 1);
  await invoke("PreToolUse", { tool_name: "request_user_input" }, 2);
  await invoke("PostToolUse", { tool_name: "Bash", tool_use_id: "other" }, 2);
  await invoke("PostToolUse", { tool_name: "request_user_input", tool_response: { answers: {} } }, 1);

  for (const response of [{ accepted: true }, JSON.stringify({ accepted: true })]) {
    await invoke("PreToolUse", { tool_name: "request_user_input_async" }, 2);
    await invoke("PostToolUse", { tool_name: "request_user_input_async", tool_response: response }, 2);
    await invoke("PostToolUse", { tool_name: "Bash", tool_use_id: "background" }, 2);
    await invoke("Stop", {}, 2);
    // Another session must not clear this session's pending question.
    await invoke("UserPromptSubmit", { session_id: "other-session" }, 1);
    await invoke("PostToolUse", { tool_name: "Bash" }, 2);
    await invoke("UserPromptSubmit", { prompt: "private answer" }, 1);
    await invoke("Stop", {}, 0);
  }
  await invoke("PreToolUse", { tool_name: "functions.request_user_input_async" }, 2);
  await invoke("PostToolUse", { tool_name: "functions.request_user_input_async", tool_response: { accepted: false } }, 1);
  for (const event of ["Interrupt", "SessionEnd", "SessionStart"]) {
    await invoke("PreToolUse", { tool_name: "request_user_input_async" }, 2);
    await invoke(event, event === "SessionStart" ? { source: "resume" } : {}, 0);
  }
  const matcher = new RegExp(config.hooks.PreToolUse[0].matcher);
  for (const tool of ["Bash", "exec_command", "apply_patch", "not_request_user_input", "request_user_input_extra"]) {
    assert.equal(matcher.test(tool), false, tool);
  }
  for (const file of await fs.readdir(path.join(temp, "ai-semaphore/codex-pending"))) {
    assert.equal((await fs.stat(path.join(temp, "ai-semaphore/codex-pending", file))).mode & 0o777, 0o600);
    assert.ok(!(await fs.readFile(path.join(temp, "ai-semaphore/codex-pending", file), "utf8")).includes("private"));
  }
  await assert.rejects(fs.access(path.join(temp, "ai-semaphore/codex-hook.log")), { code: "ENOENT" });
});

test("saved token regeneration and startup denial without an environment token", async (t) => {
  const plugin = await loadPlugin({ AI_SEMAPHORE_PORT: "47663" });
  t.after(async () => {
    plugin.server.closeAllConnections();
    await new Promise(resolve => plugin.server.close(resolve));
  });
  const post = token => fetch(`${plugin.url}/status/codex`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: '{"state":"red"}',
  });
  assert.equal((await post("undefined")).status, 401);
  vm.runInContext("handleGlobalSettings({})", plugin.context);
  const generated = plugin.socket.messages.find(m => m.event === "setGlobalSettings").payload.token;
  assert.match(generated, /^[0-9a-f-]{36}$/);
  assert.equal((await post(generated)).status, 204);
  vm.runInContext('handleGlobalSettings({token: "new-saved-token", port: 47663})', plugin.context);
  assert.equal((await post(generated)).status, 401);
  assert.equal((await post("new-saved-token")).status, 204);
  for (const invalidToken of [null, 123, "", "<YOUR_TOKEN>", "a\nb", "a b"]) {
    assert.equal(vm.runInContext(`isValidToken(${JSON.stringify(invalidToken)})`, plugin.context), false);
  }
});

test("Claude and Copilot configured commands work with manually pasted tokens", async (t) => {
  const token = "test-manually-pasted-token";
  const plugin = await loadPlugin({ AI_SEMAPHORE_PORT: "47663" });
  plugin.socket.emit("message", JSON.stringify({
    event: "didReceiveGlobalSettings", payload: { settings: { token, port: 47663 } },
  }));
  plugin.socket.emit("message", JSON.stringify({ event: "willAppear", context: "key" }));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-semaphore-hooks-"));
  t.after(async () => {
    plugin.server.closeAllConnections();
    await new Promise(resolve => plugin.server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });

  for (const [source, folder, configFile, expected] of [
    ["claude", "claude-code-hooks", "settings.snippet.json", {
      SessionStart: "green", UserPromptSubmit: "yellow", PreToolUse: "yellow",
      PermissionRequest: "red", Notification: "red", PostToolUse: "yellow",
      Elicitation: "red", ElicitationResult: "yellow",
      PostToolUseFailure: "yellow", Stop: "green", StopFailure: "green", SessionEnd: "green",
    }],
    ["copilot", "copilot-cli-hooks", "ai-semaphore.json", {
      sessionStart: "green", userPromptSubmitted: "yellow", preToolUse: "yellow",
      permissionRequest: "red", postToolUse: "yellow", postToolUseFailure: "yellow",
      agentStop: "green", errorOccurred: "green", sessionEnd: "green",
    }],
  ]) {
    await t.test(source, async () => {
      const directory = path.resolve(pluginDir, "../..", folder);
      const config = JSON.parse(await fs.readFile(path.join(directory, configFile), "utf8"));
      assert.deepEqual(Object.keys(config.hooks).sort(), Object.keys(expected).sort());
      if (source === "copilot") assert.equal(config.version, 1);
      const home = path.join(temp, `${source} home`);
      const installedDir = path.join(home, `.${source}`);
      await fs.mkdir(installedDir, { recursive: true });
      const script = path.join(installedDir, "ai-semaphore-hook.sh");
      const template = await fs.readFile(path.join(directory, "ai-semaphore-hook.sh"), "utf8");
      assert.equal(template.split("<YOUR_TOKEN>").length - 1, 2); // assignment and missing-token guard
      await fs.writeFile(script, template.replace("TOKEN='<YOUR_TOKEN>'", `TOKEN='${token}'`), { mode: 0o700 });
      const env = {
        ...process.env, HOME: home, XDG_CACHE_HOME: home,
        AI_SEMAPHORE_PORT: String(plugin.server.address().port),
        AI_SEMAPHORE_TOKEN: "unrelated-environment-token", // manual token is authoritative
        http_proxy: "http://127.0.0.1:1", ALL_PROXY: "http://127.0.0.1:1", NO_PROXY: "",
      };
      // A user curlrc must not override the notification or leak its response to stdout.
      await fs.writeFile(path.join(home, ".curlrc"), 'url = "http://127.0.0.1:1"\nverbose\n');
      const invoke = async (event, matchValue = "", expectedState = expected[event]) => {
        const groups = config.hooks[event].filter(group => source !== "claude" ||
          !group.matcher || new RegExp(group.matcher).test(matchValue));
        assert.equal(groups.length, 1, `${event}:${matchValue} must notify exactly once`);
        const group = groups[0];
        const handler = source === "claude" ? group.hooks[0] : group;
        const command = source === "claude" ? handler.command : handler.bash;
        assert.equal(command, `"$HOME/.${source}/ai-semaphore-hook.sh" ${expectedState}`);
        assert.equal(handler.type, "command");
        assert.equal(source === "claude" ? handler.timeout : handler.timeoutSec, 5);
        // Claude sends hook input on stdin; the notifier must leave it private.
        const input = JSON.stringify({ hook_event_name: event, tool_name: matchValue, tool_input: { private: "never-print-this" } });
        const output = await new Promise((resolve, reject) => {
          const child = execFile("bash", ["-c", command], { env, cwd: temp, timeout: 4500 },
            (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
          child.stdin.on("error", error => { if (error.code !== "EPIPE") reject(error); });
          child.stdin.end(input);
        });
        assert.equal(output.stdout, "");
        assert.equal(output.stderr, "");
        const state = { green: 0, yellow: 1, red: 2 }[expectedState];
        const status = await (await fetch(`${plugin.url}/status`)).json();
        assert.equal(status[source], state);
        const rendered = plugin.socket.messages.filter(m => m.event === "setState").at(-1);
        assert.equal(rendered.payload.state, state);
      };
      // Includes working -> permission -> working -> idle, and recovery from tool errors.
      for (const event of Object.keys(expected)) {
        const matchValue = { SessionStart: "startup", PreToolUse: "Bash", Notification: "permission_prompt" }[event] || "";
        await invoke(event, matchValue);
      }
      if (source === "claude") {
        // Questions must remain red until answered, without a competing yellow hook.
        await invoke("UserPromptSubmit");
        await invoke("PreToolUse", "AskUserQuestion", "red");
        await invoke("PostToolUse", "AskUserQuestion");
        await invoke("Elicitation", "test-mcp-server");
        await invoke("ElicitationResult", "test-mcp-server");
        await invoke("Stop");
        assert.equal(config.hooks.Notification[0].matcher, "permission_prompt");
        for (const notification of ["idle_prompt", "auth_success", "elicitation_complete"]) {
          assert.ok(!new RegExp(config.hooks.Notification[0].matcher).test(notification));
        }
        const matcher = new RegExp(config.hooks.SessionStart[0].matcher);
        for (const start of ["startup", "resume", "clear", "fork"]) assert.ok(matcher.test(start));
        assert.ok(!matcher.test("compact"));
      }
      const log = path.join(home, `ai-semaphore/${source}-hook.log`);
      await assert.rejects(fs.access(log), { code: "ENOENT" });
      for (const [inlineToken, pattern] of [["<YOUR_TOKEN>", /token not configured/], ["wrong-token", /HTTP 401/]]) {
        await fs.writeFile(script, template.replace("TOKEN='<YOUR_TOKEN>'", `TOKEN='${inlineToken}'`), { mode: 0o700 });
        const result = await runFile("bash", [script, "red"], { env, timeout: 4500 });
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        const contents = await fs.readFile(log, "utf8");
        assert.match(contents, pattern);
        assert.ok(!contents.includes(token));
        assert.ok(!contents.includes("wrong-token"));
        assert.equal((await (await fetch(`${plugin.url}/status`)).json())[source], 0);
      }
    });
  }
});
