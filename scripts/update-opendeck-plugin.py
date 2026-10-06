#!/usr/bin/env python3
"""Install AI Semaphore on Linux and restart OpenDeck without orphan plugins."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass


PLUGIN_ID = "com.aistatus.opendeck.sdPlugin"
FLATPAK_ID = "me.amankhanna.opendeck"
SOURCE = Path(__file__).resolve().parents[1] / "streamdeck-plugin" / PLUGIN_ID


@dataclass
class Process:
    pid: int
    start: str
    executable: Path
    cwd: Path
    args: list


def process_start(pid):
    # Field 22, after the parenthesized command (which may contain spaces).
    fields = (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
    return None if fields[0] == "Z" else fields[19]


def processes():
    result = []
    for directory in Path("/proc").iterdir():
        if not directory.name.isdigit():
            continue
        try:
            if directory.stat().st_uid != os.getuid():
                continue
            pid = int(directory.name)
            start = process_start(pid)
            if start is None:
                continue
            args = [a.decode() for a in (directory / "cmdline").read_bytes().split(b"\0") if a]
            result.append(Process(pid, start, (directory / "exe").resolve(strict=True),
                                  (directory / "cwd").resolve(strict=True), args))
        except (OSError, UnicodeError, ValueError, IndexError):
            continue
    return result


def is_semaphore(process):
    for index, arg in enumerate(process.args[:-1]):
        if arg == "-pluginUUID" and process.args[index + 1] == PLUGIN_ID:
            return True
    return False


def app_environment(process):
    env = os.environ.copy()
    if process:
        data = (Path("/proc") / str(process.pid) / "environ").read_bytes()
        for entry in data.split(b"\0"):
            if b"=" not in entry:
                continue
            key, value = entry.decode().split("=", 1)
            if key in ("DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR",
                       "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY", "XDG_SESSION_TYPE", "PATH",
                       "AI_SEMAPHORE_TOKEN", "AI_SEMAPHORE_PORT"):
                env[key] = value
    return env


def stop_process(process):
    # Recheck the start time before signalling: a reused PID is a different app.
    try:
        if process_start(process.pid) != process.start:
            return
        os.kill(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except FileNotFoundError:
        return
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            if process_start(process.pid) != process.start:
                return
        except FileNotFoundError:
            return
        time.sleep(0.1)
    raise RuntimeError(f"PID {process.pid} did not exit. No forced kill was performed; close it and retry.")


def validate_source(source):
    for name in ("plugin.js", "manifest.json", "pi/index.html", "node_modules/ws/index.js"):
        if not (source / name).is_file():
            raise RuntimeError(f"Missing source file: {source / name}. Include the bundled node_modules.")
    manifest = json.loads((source / "manifest.json").read_text())
    if not any(a.get("UUID") == "com.aistatus.opendeck.status" for a in manifest.get("Actions", [])):
        raise RuntimeError("The source manifest is not AI Semaphore.")
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 20+ must be available in PATH before installing.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if int(version.lstrip("v").split(".")[0]) < 20:
        raise RuntimeError("Node.js 20+ is required.")
    subprocess.run([node, "--check", str(source / "plugin.js")], check=True)


def install(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".ai-semaphore-update-", dir=destination.parent))
    backup = None
    try:
        shutil.copytree(source, staging, dirs_exist_ok=True)
        (staging / "plugin.js").chmod((staging / "plugin.js").stat().st_mode | 0o111)
        if destination.exists():
            backup_root = destination.parent.parent / "plugin-backups"
            backup_root.mkdir(parents=True, exist_ok=True)
            backup_dir = Path(tempfile.mkdtemp(prefix="ai-semaphore-", dir=backup_root))
            backup = backup_dir / PLUGIN_ID
            destination.rename(backup)
        try:
            staging.rename(destination)
        except OSError:
            if backup is not None:
                backup.rename(destination)
            raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return backup


def owns_port(port, active):
    inodes = set()
    for name in ("tcp", "tcp6"):
        for line in (Path("/proc/net") / name).read_text().splitlines()[1:]:
            fields = line.split()
            if fields[3] == "0A" and int(fields[1].split(":")[1], 16) == port:
                inodes.add(f"socket:[{fields[9]}]")
    for process in active:
        try:
            for descriptor in (Path("/proc") / str(process.pid) / "fd").iterdir():
                try:
                    if os.readlink(descriptor) in inodes:
                        return True
                except OSError:
                    continue
        except FileNotFoundError:
            continue
    return False


def check_server(port, destination, timeout=15):
    # Ignore HTTP proxy environment settings for this loopback-only request.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with opener.open(f"http://127.0.0.1:{port}/status", timeout=1) as response:
                status = json.load(response)
            if not all(status.get(key) in (0, 1, 2) for key in ("claude", "opencode", "copilot", "codex")):
                raise RuntimeError("The status server is an old/incompatible plugin; Copilot or Codex is missing.")
            active = [p for p in processes() if is_semaphore(p)]
            if active and all(p.cwd == destination for p in active) and owns_port(port, active):
                return status, active
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise RuntimeError(f"Could not verify the installed plugin on port {port}. Check the restart log and OpenDeck plugin logs.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flatpak", action="store_true", help="Use the Flatpak installation of OpenDeck")
    parser.add_argument("--plugins-dir", type=Path, help="Custom OpenDeck plugins directory")
    parser.add_argument("--dry-run", action="store_true", help="Show the update plan without changing files or processes")
    args = parser.parse_args(argv)
    if not sys.platform.startswith("linux") or not Path("/proc").is_dir():
        raise RuntimeError("This updater supports Linux only; use the manual README steps on other systems.")
    if os.geteuid() == 0:
        raise RuntimeError("Run this script as your regular user, without sudo.")
    base = (Path.home() / ".var/app" / FLATPAK_ID / "config" if args.flatpak
            else Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))))
    plugins_dir = args.plugins_dir or base / "opendeck/plugins"
    candidate = plugins_dir.expanduser() / PLUGIN_ID
    if candidate.is_symlink():
        raise RuntimeError("The destination is a symlink; choose a real plugin directory.")
    destination = candidate.resolve()
    source = SOURCE.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise RuntimeError("Source and installation directories must not overlap.")
    validate_source(source)
    running = processes()
    apps = [p for p in running if p.executable.name == "opendeck"]
    if len(apps) > 1:
        raise RuntimeError("Multiple OpenDeck apps are running. Close the extra instances and retry.")
    app = apps[0] if apps else None
    if app:
        app_data = (Path("/proc") / str(app.pid) / "environ").read_bytes().split(b"\0")
        is_flatpak = f"FLATPAK_ID={FLATPAK_ID}".encode() in app_data
        if args.flatpak != is_flatpak:
            raise RuntimeError("The running OpenDeck installation does not match --flatpak. Select the same installation or close it first.")
    launcher = shutil.which("flatpak" if args.flatpak else "opendeck")
    if not launcher:
        raise RuntimeError("OpenDeck launcher not found in PATH.")
    command = [launcher, "run", FLATPAK_ID, "--hide"] if args.flatpak else [launcher, "--hide"]
    env = app_environment(app)
    settings_path = destination.parent.parent / "settings" / f"{PLUGIN_ID}.json"
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    port = int(env.get("AI_SEMAPHORE_PORT") or settings.get("port", 47663))
    if not 1 <= port <= 65535:
        raise RuntimeError("Configured status port must be between 1 and 65535.")
    print(f"Source: {source}\nDestination: {destination}\nStatus port: {port}")
    if app:
        print(f"Will close OpenDeck PID {app.pid}, then stop any surviving AI Semaphore processes.")
    for process in running:
        if is_semaphore(process):
            print(f"AI Semaphore PID {process.pid}: {process.cwd}")
    print("Will back up the old plugin, install the new files, restart OpenDeck and verify /status.")
    if args.dry_run:
        print("Dry run: no files or processes changed.")
        return 0
    if app:
        stop_process(app)
    # Re-enumerate after OpenDeck exits, including surviving copies in Trash.
    for process in processes():
        if is_semaphore(process):
            stop_process(process)
    backup = install(source, destination)
    print(f"Installed AI Semaphore. Backup: {backup or 'none (first install)'}")
    log_dir = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "ai-semaphore"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "opendeck-update.log"
    print(f"Restart log: {log_path}")
    with log_path.open("ab") as log:
        subprocess.Popen(command, env=env, cwd=Path.home(), stdin=subprocess.DEVNULL,
                         stdout=log, stderr=log, start_new_session=True)
    status, active = check_server(port, destination)
    digest = hashlib.sha256((destination / "plugin.js").read_bytes()).hexdigest()
    print(f"Verified active plugin: {destination} (PIDs {', '.join(str(p.pid) for p in active)})")
    print(f"plugin.js SHA256: {digest}\nStatus: {json.dumps(status)}")
    print("Update complete. Profiles, saved token/port and installed CLI hooks were preserved.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Update failed: {error}", file=sys.stderr)
        sys.exit(1)
