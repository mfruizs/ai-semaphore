# AI Semaphore — semáforo de estado para Claude Code, Copilot CLI, Codex CLI y OpenCode en OpenDeck

[English](README.md)

<p align="center">
  <img src="docs/pluginIcon.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:200px; height:200px">
  <br>
{  <img src="docs/state-red.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:50px; height:50px">
   <img src="docs/state-yellow.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:50px; height:50px">
   <img src="docs/state-green.png" alt="AI Semaphore appearance in the OpenDeck interface" style="width:50px; height:50px">}
  <br>
</p>

- 🔴 **Rojo** — alguno de los cuatro está esperando tu confirmación/permiso.
- 🟡 **Amarillo** — alguno está trabajando (y ninguno en rojo).
- 🟢 **Verde** — los cuatro están listos para una tarea nueva.

Prioridad al combinar: **rojo > amarillo > verde** (si uno pide confirmación,
manda el rojo aunque otro esté trabajando).

Pulsar la tecla muestra 3 segundos el detalle por herramienta (`C:` Claude,
`O:` OpenCode, `G:` GitHub Copilot, `X:` Codex) por si quieres saber cuál de
las cuatro está en ese estado.

## Piezas

```
streamdeck-plugin/    -> el plugin de OpenDeck (la tecla + el servidor de estado local)
claude-code-hooks/    -> hooks para que Claude Code avise al semáforo
copilot-cli-hooks/    -> hooks para que Copilot CLI avise al semáforo
codex-cli-hooks/      -> hooks para que Codex CLI avise al semáforo
opencode-plugin/      -> plugin de OpenCode que avise al semáforo
```

Todo se comunica por HTTP en `127.0.0.1:47663` (configurable). El propio
plugin de OpenDeck es el que levanta ese servidor — no hace falta ningún
proceso adicional corriendo.

## 1. Instalar o actualizar el plugin de OpenDeck

### Instalación/actualización automática en Linux

Desde la raíz del repositorio, tras descargar la versión que quieras instalar:

```bash
python3 scripts/update-opendeck-plugin.py --dry-run  # solo muestra los pasos
python3 scripts/update-opendeck-plugin.py            # instala y reinicia
```

Ejecútalo con tu usuario normal, **sin sudo**. Requiere Python 3.8+, Node.js 20+
y el ejecutable `opendeck` en el PATH. Para la instalación Flatpak:

```bash
python3 scripts/update-opendeck-plugin.py --flatpak
```

Si usas otra ubicación, añade `--plugins-dir /ruta/a/opendeck/plugins`.
El script localiza el código a partir de su propia ubicación, por lo que también
puedes ejecutarlo desde otra carpeta indicando su ruta completa.

El actualizador:

1. Valida los archivos y `node_modules` antes de detener nada.
2. Cierra OpenDeck completamente y detiene los procesos de AI Semaphore que
   sigan vivos, incluidas copias antiguas movidas a la papelera. Solo identifica
   este plugin por su UUID exacto; no detiene otros procesos Node ni fuerza
   la terminación.
3. Guarda el plugin anterior fuera de `plugins/` e instala la carpeta nueva
   completa. Si falla el intercambio de carpetas, restaura la anterior.
4. Reinicia OpenDeck y comprueba que el proceso nuevo es quien escucha en el
   puerto configurado, se ejecuta desde la carpeta instalada y reconoce
   las cuatro herramientas.

**Este reinicio afecta a OpenDeck y al plugin.** Conserva los perfiles, las
teclas asignadas, el token y el puerto guardados, y los hooks instalados.
Los colores en memoria empiezan en verde hasta que lleguen nuevos eventos.
No hace falta regenerar el token, restablecer el dispositivo ni volver a
agregar la acción. En la primera instalación, añade la acción AI Semaphore
a una tecla después del reinicio.

El script muestra la ruta de la copia de respaldo dentro de `plugin-backups/`
de OpenDeck. Deja las copias fuera de `plugins/` para que no se cargue una vieja.
El log del reinicio queda en
`${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore/opendeck-update.log`.
Si falla la comprobación, el comando termina con error: revisa ese log, los logs
del plugin en OpenDeck y el puerto del panel de propiedades.
Se ha probado la instalación nativa de Linux; usa `--dry-run` para revisar
una instalación Flatpak o personalizada antes de actualizarla.

### Instalación manual (incluidos Windows/macOS)

Antes de sustituir una instalación existente, sigue los pasos de actualización
que aparecen más abajo.

1. Copia la carpeta `streamdeck-plugin/com.aistatus.opendeck.sdPlugin/`
   (tal cual, con `node_modules/` incluido) a la carpeta de plugins de OpenDeck:

   ```bash
   cp -r streamdeck-plugin/com.aistatus.opendeck.sdPlugin \
     ~/.config/opendeck/plugins/
   ```

   (En Flatpak sería `~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/`.)

   **En Windows**, copia la carpeta a `%AppData%\opendeck\plugins\` en su
   lugar. El manifest ya incluye `CodePathWin` apuntando a `launch.bat`
   (incluido en la carpeta), que es lo que OpenDeck ejecuta en esa
   plataforma — solo necesitas tener [Node.js 20+](https://nodejs.org)
   instalado y que `node --version` funcione desde una consola cualquiera.
   En Linux y macOS se usa `plugin.js` directamente (vía `CodePath` /
   `CodePathMac`, con su shebang `#!/usr/bin/env node`), no necesitas nada
   adicional ahí.

<p align="center">
  <img src="docs/ia-semaphore-icon.png" alt="Aspecto del Semáforo IA en la interfaz de OpenDeck">
  <br>
  <em>Así se ve el semáforo en estado verde (listo para nuevas tareas) una vez asignado a una tecla de tu Stream Deck Mini.</em>
</p>

2. Sal de OpenDeck por completo, incluido su proceso en segundo plano o bandeja,
   y ábrelo de nuevo. Restablecer la tecla o sustituir los archivos no recarga
   un plugin que sigue ejecutándose.

3. En la app añade la acción **"Semáforo IA"** a una tecla de tu Stream Deck Mini.

<p align="center">
  <img src="docs/ia-semaphore-config.png" alt="Panel de configuración del Property Inspector">
  <br>
  <em>Desde el panel de propiedades puedes copiar tu token de seguridad único o modificar el puerto por defecto si tienes algún conflicto.</em>
</p>

4. Comprueba que el servidor de estado responde:

   ```bash
   curl http://127.0.0.1:47663/status
   # {"claude":0,"opencode":0,"copilot":0,"codex":0,"port":47663}  -> 0=verde, 1=amarillo, 2=rojo
   ```

   En Windows (PowerShell): `Invoke-RestMethod http://127.0.0.1:47663/status`

### Actualización manual y diagnóstico

1. Sal de OpenDeck completamente antes de copiar el plugin nuevo. Cerrar la
   ventana puede dejar la aplicación en segundo plano.
2. Comprueba si quedan procesos de AI Semaphore y detén solo los identificados
   por `-pluginUUID com.aistatus.opendeck.sdPlugin`. Mover la carpeta vieja a la
   papelera no detiene su proceso. En Linux, el script anterior se encarga de ello.
3. Guarda una copia del plugin anterior fuera de la carpeta de plugins y
   sustituye la carpeta instalada por la nueva, incluido `node_modules`.
   Conserva las carpetas separadas `settings/` y `profiles/` de OpenDeck.
4. Abre OpenDeck y comprueba el servidor con el puerto configurado:

   ```bash
   curl "http://127.0.0.1:${AI_SEMAPHORE_PORT:-47663}/status"
   ```

   Deben aparecer **`claude`, `opencode`, `copilot` y `codex`**. Si solo aparecen
   Claude/OpenCode, el puerto sigue atendido por una versión antigua.
   Un `HTTP 404` para `/status/codex` en el log del hook puede indicar lo mismo.
   Un `401` apunta a un problema con el token de autenticación.
5. En Linux, identifica quién ocupa el puerto si aún hay un conflicto:

   ```bash
   ss -ltnp 'sport = :47663'
   ```

   Con el PID mostrado, revisa `/proc/<PID>/cwd`: debe apuntar a la carpeta
   instalada `com.aistatus.opendeck.sdPlugin`, nunca a una copia en la papelera.
   Ajusta `47663` si cambiaste el puerto. Si lo ocupa otro servicio, cambia el
   puerto en OpenDeck y en las integraciones en lugar de detener ese servicio.

## 2. Copiar el token de autenticación

El servidor local del plugin solo escucha en `127.0.0.1`, pero eso no basta:
cualquier otro proceso de tu máquina (o una pestaña del navegador, que puede
mandar peticiones POST "simples" a `localhost` sin que salte el CORS) podría
mandarle un POST y falsear el semáforo. Por eso las peticiones que cambian
estado exigen un token.

La primera vez que arranca el plugin genera un token aleatorio y lo guarda.
Para verlo:

1. En OpenDeck, haz clic sobre la tecla "Semáforo IA" para abrir su panel de
   configuración (el Property Inspector).
2. Verás el campo **"Token de autenticación del semáforo"** con dos botones:
   **Copiar** y **Regenerar**.
3. Cópialo — lo necesitas en los pasos de conexión de abajo.

Si alguna vez sospechas que se ha filtrado, pulsa **Regenerar** y actualízalo
en todos los sitios de abajo (el anterior deja de funcionar al instante).

## 3. (Opcional) Cambiar el puerto

Por defecto todo usa el `47663`. Si choca con otra cosa en tu máquina, en el
mismo panel del Property Inspector verás el campo **"Puerto del servidor
local"** con su botón **Guardar puerto** — al guardar, el plugin reinicia su
servidor ahí mismo, sin tener que reiniciar OpenDeck.

Eso sí: los demás consumidores (los hooks de Claude, Copilot, Codex y el
plugin de OpenCode) no se enteran solos del cambio. Tienes dos formas de
mantenerlos sincronizados:

- **Manual**: edita el número `47663` en los hooks de Claude/Copilot, en
  `ai-semaphore-hook.sh` para Codex y en `ai-semaphore.ts`.
- **Con variable de entorno**: exporta `AI_SEMAPHORE_PORT=<nuevo_puerto>` en
  el shell desde el que arrancas cada herramienta (por ejemplo en tu
  `~/.bashrc`/`~/.zshrc`). Todos los archivos ya la leen si está presente,
  así que no hace falta tocar nada más.

## 4. Conectar Claude Code

Esta integración usa Bash y curl (Linux/macOS). Instala el script:

```bash
mkdir -p ~/.claude
cp claude-code-hooks/ai-semaphore-hook.sh ~/.claude/ai-semaphore-hook.sh
chmod +x ~/.claude/ai-semaphore-hook.sh
```

Abre el script instalado y sustituye `<YOUR_TOKEN>` **solo en la línea
`TOKEN='<YOUR_TOKEN>'`** por el token copiado del panel de OpenDeck. Este token
se configura manualmente; `AI_SEMAPHORE_TOKEN` no lo sobrescribe. Comprueba que
`PORT` coincide con el puerto del panel (por defecto `47663`).

Integra el objeto `hooks` de `claude-code-hooks/settings.snippet.json` en
`~/.claude/settings.json` (o `.claude/settings.json` del proyecto). El snippet ya
contiene el objeto raíz `hooks`: no lo anides dentro de otro `hooks`. Conserva
los ajustes y hooks existentes; si un evento ya existe, añade nuestras entradas
a su array. Los comandos usan el script de `$HOME/.claude/` aunque la
configuración sea de un proyecto. Reinicia la sesión de Claude para cargarlo.

| Evento | Estado |
| --- | --- |
| `SessionStart` (startup/resume/clear/fork) | Verde |
| `UserPromptSubmit`, `PreToolUse` | Amarillo |
| `PermissionRequest` | Rojo, al solicitar permiso |
| `Notification` (solo `permission_prompt`) | Rojo; cubre también avisos de permisos de red |
| `PostToolUse`, `PostToolUseFailure` | Amarillo, al retomar tras la herramienta |
| `Stop`, `StopFailure`, `SessionEnd` | Verde |

`PermissionRequest` evita esperar a la notificación de permiso. La
compactación y las notificaciones de inactividad no reinician el semáforo.
Referencia: [hooks de Claude Code](https://code.claude.com/docs/en/hooks).

## 5. Conectar Copilot CLI

Esta integración usa Bash y curl (Linux/macOS). Instala el script y la
configuración global:

```bash
mkdir -p ~/.copilot/hooks
cp copilot-cli-hooks/ai-semaphore-hook.sh ~/.copilot/ai-semaphore-hook.sh
chmod +x ~/.copilot/ai-semaphore-hook.sh
cp copilot-cli-hooks/ai-semaphore.json ~/.copilot/hooks/ai-semaphore.json
```

Abre el script instalado y sustituye `<YOUR_TOKEN>` **solo en la línea
`TOKEN='<YOUR_TOKEN>'`** por el mismo token de OpenDeck. `AI_SEMAPHORE_TOKEN`
no lo sobrescribe. Si usas un puerto distinto, ajusta `PORT` o exporta
`AI_SEMAPHORE_PORT` antes de lanzar Copilot.

Para limitar los hooks a un proyecto, copia el JSON a
`.github/hooks/ai-semaphore.json` en lugar de la carpeta global; los comandos
siguen usando el script de `$HOME/.copilot/`. Copilot CLI carga los JSON al
arrancar. Conserva los hooks existentes y reinicia Copilot tras instalarlos.
El JSON incluido define comandos `bash`; Windows nativo requiere una
implementación PowerShell y entradas `powershell`.

| Evento | Estado |
| --- | --- |
| `sessionStart` | Verde |
| `userPromptSubmitted`, `preToolUse` | Amarillo |
| `permissionRequest` | Rojo |
| `postToolUse`, `postToolUseFailure` | Amarillo, al retomar tras la herramienta |
| `agentStop`, `errorOccurred`, `sessionEnd` | Verde |

En Copilot, `permissionRequest` se ejecuta antes de evaluar los permisos,
incluso los automáticos: puede aparecer un breve rojo sin pedir confirmación.
Estos hooks no devuelven decisiones de permiso. Esta integración es para el
CLI local; el agente en la nube no puede acceder al OpenDeck de tu máquina.
Referencia: [hooks de Copilot](https://docs.github.com/en/copilot/reference/hooks-reference).

Prueba cualquiera de los dos scripts instalados desde el mismo entorno:

```bash
~/.claude/ai-semaphore-hook.sh yellow  # o ~/.copilot/ai-semaphore-hook.sh
curl "http://127.0.0.1:${AI_SEMAPHORE_PORT:-47663}/status"
~/.claude/ai-semaphore-hook.sh red
~/.claude/ai-semaphore-hook.sh green
```

El campo `claude` (o `copilot`) debe pasar por `1`, `2` y `0`. Las peticiones
usan el token manual, conexión directa a `127.0.0.1` y timeout de dos segundos.
Los scripts terminan con código `0` y salida vacía incluso si falla el
semáforo. Consulta `${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore/claude-hook.log`
o `copilot-hook.log`: `401` indica token incorrecto; `204`, estado aplicado.
El log no incluye tokens. Al regenerar el token, actualiza la línea `TOKEN`
de cada script instalado. Varias sesiones de la misma IA comparten un estado.

Si `/status` no incluye `copilot` y `codex`, actualiza el plugin de OpenDeck con
la carpeta de este repositorio y reinicia OpenDeck para cargar esa versión.

## 6. Conectar Codex CLI

Esta integración requiere Bash y curl (Linux/macOS o un entorno que tenga
ambos). Consulta la [documentación oficial de hooks de Codex](https://learn.chatgpt.com/docs/hooks)
para la disponibilidad según versión. Las versiones recientes activan los hooks
por defecto; si hace falta, actívalos en el bloque `[features]` existente de
`~/.codex/config.toml`:

```toml
[features]
hooks = true
```

Instala los dos archivos:

```bash
mkdir -p ~/.codex
cp codex-cli-hooks/ai-semaphore-hook.sh ~/.codex/ai-semaphore-hook.sh
chmod +x ~/.codex/ai-semaphore-hook.sh
cp codex-cli-hooks/hooks.json ~/.codex/hooks.json
```

Si ya tienes hooks, integra las entradas de los eventos en el objeto `hooks`
existente en lugar de sobrescribir el archivo. Para usarlos solo en un proyecto,
pon `hooks.json` en `<tu_repo>/.codex/`; el proyecto debe ser de confianza.
Los comandos incluidos siguen usando el script de `$HOME/.codex/`, sin depender
del directorio de trabajo de la sesión. Si usas un `CODEX_HOME` personalizado,
ajusta las rutas de instalación y los comandos de los hooks.

Configura el token **manualmente una sola vez**: sustituye `<YOUR_TOKEN>` en
la asignación `TOKEN` del `ai-semaphore-hook.sh` instalado por el token del
panel de OpenDeck. `hooks.json` no contiene ningún token. Ajusta `PORT` si has
cambiado el puerto del panel. Este script también admite `AI_SEMAPHORE_TOKEN`
y `AI_SEMAPHORE_PORT`; si están exportadas, tienen prioridad sobre los valores
manuales del script.

Arranca Codex y abre `/hooks` para revisar y confiar en las definiciones nuevas
o modificadas. Codex omite los hooks sin confianza. Cambiar el token en el script
o en el entorno mantiene los comandos; editar `hooks.json` requiere otra revisión.

| Evento | Estado |
| --- | --- |
| `SessionStart` (startup/resume/clear) | Verde |
| `UserPromptSubmit` | Amarillo |
| `PermissionRequest` | Rojo |
| `PostToolUse` | Amarillo; recupera el estado de trabajo tras un permiso |
| `Stop`, `Interrupt`, `SessionEnd` | Verde |

La compactación no reinicia el semáforo. `PermissionRequest` marca rojo cuando
Codex solicita aprobación; con `approval_policy = "never"` no esperes ese flujo.
Las aprobaciones automáticas pueden producir un breve parpadeo rojo. Cada fuente
guarda un solo estado, por lo que varias sesiones de la misma herramienta se
sobrescriben entre sí.

Prueba la conexión sin Codex, desde el mismo entorno:

```bash
~/.codex/ai-semaphore-hook.sh yellow
curl "http://127.0.0.1:${AI_SEMAPHORE_PORT:-47663}/status"
~/.codex/ai-semaphore-hook.sh red
~/.codex/ai-semaphore-hook.sh green
```

El valor `codex` debe pasar a `1`, `2` y `0`. El script termina con código `0`
y stdout vacío incluso si falla, para que el semáforo no bloquee Codex.
Consulta `${XDG_CACHE_HOME:-$HOME/.cache}/ai-semaphore/codex-hook.log` para detectar
tokens sin configurar, configuración inválida, fallos de curl o respuestas HTTP
inesperadas. `401` indica token ausente/incorrecto; `400`, JSON/estado inválido;
`204`, estado aplicado. Las peticiones tienen un timeout de dos segundos.
El log nunca incluye el token ni el cuerpo de respuesta del servidor.

## 7. Conectar OpenCode

Copia `opencode-plugin/ai-semaphore.ts` a:

- `~/.config/opencode/plugins/ai-semaphore.ts` para que aplique a todas tus
  sesiones, o
- `.opencode/plugins/ai-semaphore.ts` dentro de un proyecto concreto.

Dentro del archivo, sustituye `<YOUR_TOKEN>` por el mismo token, o —más cómodo
si lo regeneras a menudo— deja esa línea tal cual y exporta
`AI_SEMAPHORE_TOKEN` en el entorno desde el que lanzas OpenCode; el plugin lo
usa automáticamente si está presente.

OpenCode carga automáticamente los `.ts`/`.js` de esas carpetas al arrancar,
no hace falta registrarlo en `opencode.json`.

## Notas

- El endpoint `GET /status` (solo lectura, útil para depurar con `curl`) no
  pide token a propósito: lo único que expone es qué color hay en cada
  fuente y el puerto activo, no permite cambiar nada.
- Si quieres saltarte el flujo del Property Inspector (por ejemplo, para
  arrancar OpenDeck desde un script), puedes fijar el token y/o el puerto tú
  mismo con las variables de entorno `AI_SEMAPHORE_TOKEN` y
  `AI_SEMAPHORE_PORT` antes de lanzarlo; el plugin las usa en vez de lo
  guardado en el Property Inspector. Mientras estén fijadas estas variables,
  los cambios guardados desde el panel no cambian el token/puerto activo;
  actualiza el entorno y reinicia OpenDeck, o elimina las variables para
  usar los ajustes guardados.
- El `Stop`/`agentStop` de cada herramienta se dispara cada vez que termina
  de responder, no solo al completar una tarea larga con varias vueltas;
  para tu caso de uso (saber cuándo puedes mandarle algo nuevo) es
  exactamente lo que hace falta.
