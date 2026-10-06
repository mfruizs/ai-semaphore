"""Updater regressions without touching a real OpenDeck installation."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("updater", Path(__file__).with_name("update-opendeck-plugin.py"))
updater = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = updater
spec.loader.exec_module(updater)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ai-semaphore-updater-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / "source"
        self.source.mkdir()
        (self.source / "plugin.js").write_text("// new plugin\n")
        (self.source / "manifest.json").write_text(json.dumps({"Actions": [{"UUID": "com.aistatus.opendeck.status"}]}))
        for name in ("pi/index.html", "node_modules/ws/index.js"):
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("test fixture")
        self.destination = self.base / "opendeck/plugins" / updater.PLUGIN_ID

    def test_update_preserves_settings_and_backups_outside_plugins(self):
        self.destination.mkdir(parents=True)
        (self.destination / "plugin.js").write_text("// old plugin\n")
        (self.destination / "stale.js").write_text("old file")
        settings = self.destination.parent.parent / "settings" / f"{updater.PLUGIN_ID}.json"
        settings.parent.mkdir()
        settings.write_text('{"token":"test-token","port":48765}')
        original = settings.read_bytes()
        backup = updater.install(self.source, self.destination)
        self.assertEqual((backup / "plugin.js").read_text(), "// old plugin\n")
        self.assertNotIn(self.destination.parent, backup.parents)
        self.assertEqual((self.destination / "plugin.js").read_text(), "// new plugin\n")
        self.assertFalse((self.destination / "stale.js").exists())
        self.assertEqual(settings.read_bytes(), original)
        self.assertTrue(os.access(self.destination / "plugin.js", os.X_OK))

    def test_first_install_has_no_backup(self):
        self.assertIsNone(updater.install(self.source, self.destination))
        self.assertTrue((self.destination / "node_modules/ws/index.js").exists())

    def test_failed_swap_restores_old_plugin(self):
        self.destination.mkdir(parents=True)
        (self.destination / "plugin.js").write_text("old plugin")
        rename = Path.rename
        def fail_staging(path, target):
            if path.name.startswith(".ai-semaphore-update-"):
                raise OSError("simulated install failure")
            return rename(path, target)
        with patch.object(Path, "rename", fail_staging):
            with self.assertRaisesRegex(OSError, "simulated"):
                updater.install(self.source, self.destination)
        self.assertEqual((self.destination / "plugin.js").read_text(), "old plugin")
        self.assertEqual(list(self.destination.parent.glob(".ai-semaphore-update-*")), [])

    def test_missing_dependency_is_rejected_before_install(self):
        (self.source / "node_modules/ws/index.js").unlink()
        with self.assertRaisesRegex(RuntimeError, "Missing source file"):
            updater.validate_source(self.source)
        self.assertFalse(self.destination.exists())

    def test_matches_only_the_exact_plugin_uuid_argument(self):
        process = updater.Process(123, "100", Path("/usr/bin/node"), self.source,
                                  ["node", "plugin.js", "-pluginUUID", updater.PLUGIN_ID])
        self.assertTrue(updater.is_semaphore(process))
        process.args = ["node", "plugin.js", "-pluginUUID", "another.sdPlugin"]
        self.assertFalse(updater.is_semaphore(process))
        process.args = ["node", "plugin.js", "-info", updater.PLUGIN_ID]
        self.assertFalse(updater.is_semaphore(process))

    def test_reused_pid_is_not_signalled(self):
        process = updater.Process(123, "old-start", Path("/usr/bin/node"), self.source, [])
        with patch.object(updater, "process_start", return_value="new-start"), patch.object(updater.os, "kill") as kill:
            updater.stop_process(process)
        kill.assert_not_called()

    @unittest.skipUnless(sys.platform.startswith("linux"), "Linux process test")
    def test_stops_a_real_orphan_candidate_in_trash(self):
        trash = self.base / "Trash/files" / updater.PLUGIN_ID
        trash.mkdir(parents=True)
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)",
                                  "-pluginUUID", updater.PLUGIN_ID], cwd=trash)
        try:
            process = next(p for p in updater.processes() if p.pid == child.pid)
            self.assertTrue(updater.is_semaphore(process))
            self.assertEqual(process.cwd, trash)
            updater.stop_process(process)
            self.assertEqual(child.wait(timeout=2), -15)
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=2)

    def test_dry_run_never_installs_stops_or_launches(self):
        with patch.object(updater, "SOURCE", self.source), \
             patch.object(updater.os, "geteuid", return_value=1000), \
             patch.object(updater, "validate_source"), \
             patch.object(updater, "processes", return_value=[]), \
             patch.object(updater.shutil, "which", return_value="/usr/bin/opendeck"), \
             patch.object(updater, "install") as install, \
             patch.object(updater, "stop_process") as stop, \
             patch.object(updater.subprocess, "Popen") as launch, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(updater.main(["--plugins-dir", str(self.destination.parent), "--dry-run"]), 0)
        install.assert_not_called()
        stop.assert_not_called()
        launch.assert_not_called()
        self.assertFalse(self.destination.parent.exists())

    def test_old_status_server_is_rejected(self):
        response = io.BytesIO(b'{"claude":0,"opencode":0,"port":47663}')
        opener = Mock()
        opener.open.return_value = response
        with patch.object(updater.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(RuntimeError, "old/incompatible"):
                updater.check_server(47663, self.destination, timeout=1)

    def test_verification_requires_the_installed_process_to_own_the_port(self):
        opener = Mock()
        opener.open.side_effect = lambda *a, **kw: io.BytesIO(b'{"claude":0,"opencode":0,"copilot":0,"codex":0}')
        process = updater.Process(123, "100", Path("/usr/bin/node"), self.destination,
                                  ["node", "plugin.js", "-pluginUUID", updater.PLUGIN_ID])
        with patch.object(updater.urllib.request, "build_opener", return_value=opener), \
             patch.object(updater, "processes", return_value=[process]), \
             patch.object(updater, "owns_port", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "Could not verify"):
                updater.check_server(47663, self.destination, timeout=0.1)


if __name__ == "__main__":
    unittest.main()
