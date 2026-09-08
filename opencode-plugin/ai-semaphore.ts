import type { Plugin } from "@opencode-ai/plugin";

// Puerto del servidor local del plugin de OpenDeck. Si lo cambiaste desde
// el Property Inspector, exporta AI_SEMAPHORE_PORT con el mismo valor antes
// de lanzar OpenCode, o edita el número de abajo directamente.
const PORT = process.env.AI_SEMAPHORE_PORT || "47663";
const STATUS_URL = `http://127.0.0.1:${PORT}`;

// Pega aquí el token que ves en la pantalla de configuración de la tecla
// "Semáforo IA" dentro de OpenDeck (botón "Copiar"). También puedes dejarlo
// tal cual y en su lugar exportar la variable de entorno AI_SEMAPHORE_TOKEN
// antes de lanzar OpenCode.
const TOKEN = process.env.AI_SEMAPHORE_TOKEN || "<TU_TOKEN>";

async function post(state: "red" | "yellow" | "green") {
  try {
    await fetch(`${STATUS_URL}/status/opencode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ state }),
    });
  } catch {
    // El plugin de Stream Deck no está corriendo o el puerto no responde;
    // lo ignoramos en silencio para no romper una sesión de OpenCode.
  }
}

export const AiSemaphore: Plugin = async () => {
  return {
    // Se dispara cuando OpenCode va a pedir confirmación al usuario
    "permission.ask": async () => {
      await post("red");
    },
    // Se dispara antes de cada ejecución de herramienta -> "trabajando"
    "tool.execute.before": async () => {
      await post("yellow");
    },
    // Eventos generales de la sesión
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await post("green");
      }
    },
  };
};

export default AiSemaphore;
