#!/usr/bin/env node
"use strict";

/**
 * AI Semaphore - plugin de OpenDeck / Stream Deck
 *
 * - Se conecta al WebSocket de OpenDeck (protocolo estándar del Stream Deck SDK).
 * - Levanta un pequeño servidor HTTP local (por defecto en el puerto 47663,
 *   configurable desde el Property Inspector) que recibe el estado de
 *   Claude Code, Copilot CLI, Codex CLI y OpenCode vía POST.
 * - Combina los estados con prioridad rojo > amarillo > verde y actualiza
 *   la tecla mediante "setState".
 * - Protege las peticiones que cambian estado con un token compartido.
 * - Token y puerto se generan/guardan como "global settings" del plugin
 *   (el mismo mecanismo que usa el Property Inspector para mostrarlos y
 *   editarlos).
 */

const WebSocket = require("ws");
const http = require("http");
const crypto = require("crypto");

// --- Argumentos que pasa OpenDeck al lanzar el plugin ---
const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const odPort = getArg("-port"); // puerto del WebSocket de OpenDeck (no confundir con el nuestro)
const pluginUUID = getArg("-pluginUUID");
const registerEvent = getArg("-registerEvent");

const DEFAULT_PORT = 47663;

// Si se fija por entorno, gana siempre sobre lo guardado en el Property
// Inspector (útil para pruebas o arranques scripteados).
function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

const configuredPort = Number(process.env.AI_SEMAPHORE_PORT);
const ENV_PORT = isValidPort(configuredPort) ? configuredPort : null;

let currentPort = ENV_PORT || DEFAULT_PORT;

// Índices de estado, deben coincidir con el orden del array "States" del manifest.json
const STATE = { GREEN: 0, YELLOW: 1, RED: 2 };
const STATE_NAMES = { red: STATE.RED, yellow: STATE.YELLOW, green: STATE.GREEN };
const LABELS = { [STATE.RED]: "ESPERA", [STATE.YELLOW]: "RUN", [STATE.GREEN]: "OK" };

// Estado por fuente. Empiezan en verde (sin sesión activa = "listo").
const sources = {
  claude: STATE.GREEN,
  opencode: STATE.GREEN,
  copilot: STATE.GREEN,
  codex: STATE.GREEN,
};

const contexts = new Set(); // instancias de la tecla actualmente visibles

// Token compartido para autenticar los POST /status/*. Puede fijarse por
// entorno (útil para pruebas); si no, se carga/genera vía global settings.
function isValidToken(value) {
  return typeof value === "string" && value.length > 0 && !/[^\x21-\x7e]/.test(value) &&
    value !== "<YOUR_TOKEN>";
}

const ENV_TOKEN = process.env.AI_SEMAPHORE_TOKEN || null;
let token = ENV_TOKEN;

function combinedState() {
  const values = Object.values(sources);
  if (values.includes(STATE.RED)) return STATE.RED;
  if (values.includes(STATE.YELLOW)) return STATE.YELLOW;
  return STATE.GREEN;
}

let ws;

function connectToOpenDeck() {
  ws = new WebSocket(`ws://127.0.0.1:${odPort}`);

  ws.on("open", () => {
    ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
    // Pedimos el token/puerto guardados (si los hay) en cuanto nos registramos.
    ws.send(JSON.stringify({ event: "getGlobalSettings", context: pluginUUID }));
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.event === "willAppear") {
      contexts.add(msg.context);
      pushState();
    } else if (msg.event === "willDisappear") {
      contexts.delete(msg.context);
    } else if (msg.event === "keyDown") {
      showDetail(msg.context);
    } else if (msg.event === "didReceiveGlobalSettings") {
      handleGlobalSettings((msg.payload && msg.payload.settings) || {});
    }
  });

  ws.on("close", () => setTimeout(connectToOpenDeck, 2000));
  ws.on("error", () => {});
}

function handleGlobalSettings(settings) {
  let mustPersist = false;

  if (ENV_TOKEN) {
    token = ENV_TOKEN;
  } else if (isValidToken(settings.token)) {
    // Toma el valor guardado (incluye regeneraciones hechas desde el
    // Property Inspector, que también llegan por este mismo evento).
    token = settings.token;
  } else if (!isValidToken(token)) {
    // Primer arranque: no hay token guardado ni fijado por entorno.
    token = crypto.randomUUID();
    mustPersist = true;
  }

  if (ENV_PORT) {
    // La variable de entorno manda; ignoramos lo que diga el PI para el
    // puerto. El token también respeta ENV_TOKEN cuando está definido.
  } else if (isValidPort(settings.port) && settings.port !== currentPort) {
    restartServer(settings.port);
  } else if (!isValidPort(settings.port)) {
    // Todavía no se ha guardado ningún puerto: publicamos el actual para
    // que el Property Inspector tenga algo que mostrar y editar.
    mustPersist = true;
  }

  if (mustPersist) {
    ws.send(JSON.stringify({
      event: "setGlobalSettings",
      context: pluginUUID,
      payload: { token, port: currentPort },
    }));
  }
}

function pushState() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const state = combinedState();
  for (const context of contexts) {
    ws.send(JSON.stringify({ event: "setState", context, payload: { state } }));
  }
}

// Al pulsar la tecla, muestra 3s el detalle por herramienta (útil cuando el
// semáforo está en amarillo/rojo y quieres saber cuál de las cuatro lo causa).
function showDetail(context) {
  const title =
    `C:${LABELS[sources.claude]}\n` +
    `O:${LABELS[sources.opencode]}\n` +
    `G:${LABELS[sources.copilot]}\n` +
    `X:${LABELS[sources.codex]}`;
  ws.send(JSON.stringify({ event: "setTitle", context, payload: { title } }));
  setTimeout(() => {
    ws.send(JSON.stringify({ event: "setTitle", context, payload: { title: "" } }));
  }, 3000);
}

function isAuthorized(req) {
  // Mientras el token todavía no se ha cargado/generado, denegamos por
  // defecto en vez de aceptar peticiones sin comprobar nada.
  if (!isValidToken(token)) return false;
  return req.headers["authorization"] === `Bearer ${token}`;
}

// --- Servidor HTTP local: aquí escriben los hooks de Claude Code, Copilot CLI, Codex CLI y el plugin de OpenCode ---
function requestHandler(req, res) {
  const match = req.url.match(/^\/status\/(claude|opencode|copilot|codex)$/);

  if (req.method === "POST" && match) {
    if (!isAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token inválido o ausente" }));
      return;
    }
    const chunks = [];
    let bodyBytes = 0;
    const MAX_BODY_BYTES = 4096;
    req.on("data", (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        if (!res.writableEnded) sendError(res, 413, "payload_too_large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        sendError(res, 400, "invalid_json");
        return;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          typeof payload.state !== "string" ||
          !Object.prototype.hasOwnProperty.call(STATE_NAMES, payload.state)) {
        sendError(res, 400, "invalid_state");
        return;
      }
      sources[match[1]] = STATE_NAMES[payload.state];
      pushState();
      res.writeHead(204);
      res.end();
    });
  } else if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...sources, port: currentPort }));
  } else {
    res.writeHead(404);
    res.end();
  }
}

function sendError(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error }));
}

let server = http.createServer(requestHandler);

function restartServer(newPort) {
  if (
    !isValidPort(newPort) ||
    newPort === currentPort
  ) {
    return;
  }
  server.close();
  server = http.createServer(requestHandler);
  server.listen(newPort, "127.0.0.1");
  currentPort = newPort;
}

server.listen(currentPort, "127.0.0.1");

connectToOpenDeck();
