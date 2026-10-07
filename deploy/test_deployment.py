import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import firewall_access


spec = importlib.util.spec_from_file_location("extract_release", Path(__file__).with_name("extract-release.py"))
extract_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract_release)
reconcile_spec = importlib.util.spec_from_file_location("reconcile_firewall", Path(__file__).with_name("reconcile-firewall.py"))
reconcile_firewall = importlib.util.module_from_spec(reconcile_spec)
reconcile_spec.loader.exec_module(reconcile_firewall)


class ReleaseArchiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.archive = Path(self.directory.name, "release.tar.gz")
        self.destination = Path(self.directory.name, "extracted")

    def write_archive(self, entries):
        with tarfile.open(self.archive, "w:gz") as archive:
            for name, contents, kind in entries:
                item = tarfile.TarInfo(name)
                if kind == "file":
                    item.size = len(contents)
                    archive.addfile(item, io.BytesIO(contents))
                elif kind == "symlink":
                    item.type = tarfile.SYMTYPE
                    item.linkname = contents
                    archive.addfile(item)
                elif kind == "hardlink":
                    item.type = tarfile.LNKTYPE
                    item.linkname = contents
                    archive.addfile(item)

    @unittest.skipIf(os.name == "nt", "Linux symlink semantics are verified in the Linux test run")
    def test_valid_internal_workspace_link(self):
        self.write_archive([
            ("shared/dist/index.js", b"export const value = 1;\n", "file"),
            ("node_modules/@cp-notes/shared", "../../shared", "symlink"),
        ])
        extract_release.extract(str(self.archive), str(self.destination))
        linked = self.destination / "node_modules/@cp-notes/shared/dist/index.js"
        self.assertEqual(linked.read_bytes(), b"export const value = 1;\n")

    def test_rejects_parent_traversal(self):
        self.write_archive([("../outside", b"private", "file")])
        with self.assertRaisesRegex(ValueError, "traversal"):
            extract_release.extract(str(self.archive), str(self.destination))
        self.assertFalse(Path(self.directory.name, "outside").exists())

    def test_rejects_link_outside_release(self):
        self.write_archive([("node_modules/escape", "../../../etc", "symlink")])
        with self.assertRaisesRegex(ValueError, "outside"):
            extract_release.extract(str(self.archive), str(self.destination))

    def test_rejects_duplicate_paths(self):
        self.write_archive([("package.json", b"one", "file"), ("package.json", b"two", "file")])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            extract_release.extract(str(self.archive), str(self.destination))

    def test_valid_internal_hard_link(self):
        self.write_archive([("shared/dist/index.js", b"module", "file"), ("backend/dist/copy.js", "shared/dist/index.js", "hardlink")])
        extract_release.extract(str(self.archive), str(self.destination))
        self.assertEqual((self.destination / "backend/dist/copy.js").read_bytes(), b"module")

    def test_rejects_hard_link_outside_release(self):
        self.write_archive([("backend/dist/copy.js", "../outside", "hardlink")])
        with self.assertRaisesRegex(ValueError, "traversal"):
            extract_release.extract(str(self.archive), str(self.destination))


class FirewallTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = str(Path(self.directory.name, "firewall.json"))

    def test_reads_all_ssh_address_families_and_aliases(self):
        states = [
            {"protocol": "tcp", "fromPort": 22, "toPort": 22, "cidrs": ["203.0.113.8/32"], "ipv6Cidrs": ["::/0"], "cidrListAliases": ["lightsail-connect"]},
            {"protocol": "tcp", "fromPort": 80, "toPort": 80, "cidrs": ["0.0.0.0/0"]},
        ]
        with patch("firewall_access.port_states", return_value=states):
            self.assertEqual(firewall_access.ssh_access("upsolve-aryan"), {
                "cidrs": ["203.0.113.8/32"],
                "ipv6Cidrs": ["::/0"],
                "cidrListAliases": ["lightsail-connect"],
            })

    def test_adds_and_closes_only_its_runner_rule(self):
        prior = {"cidrs": ["203.0.113.8/32"], "ipv6Cidrs": [], "cidrListAliases": ["lightsail-connect"]}
        opened = {**prior, "cidrs": [*prior["cidrs"], "198.51.100.20/32"]}
        with patch("firewall_access.urllib.request.urlopen", return_value=io.BytesIO(b"198.51.100.20\n")), patch("firewall_access.ssh_access", side_effect=[prior, opened, opened, prior]), patch("firewall_access.aws") as aws:
            firewall_access.open_access("upsolve-aryan", self.state, "100-1")
            firewall_access.close_access("upsolve-aryan", self.state)
        self.assertEqual(json.loads(Path(self.state).read_text())["previousAccess"], prior)
        self.assertEqual(aws.call_args_list[0].args[0], "open-instance-public-ports")
        self.assertEqual(aws.call_args_list[1].args[0], "close-instance-public-ports")

    def test_refuses_public_ssh(self):
        public = {"cidrs": ["0.0.0.0/0"], "ipv6Cidrs": [], "cidrListAliases": []}
        with patch("firewall_access.urllib.request.urlopen", return_value=io.BytesIO(b"198.51.100.20\n")), patch("firewall_access.ssh_access", return_value=public):
            with self.assertRaisesRegex(ValueError, "internet"):
                firewall_access.open_access("upsolve-aryan", self.state, "100-1")
        self.assertFalse(os.path.exists(self.state))

    def test_refuses_public_ipv6_ssh(self):
        public = {"cidrs": [], "ipv6Cidrs": ["::/0"], "cidrListAliases": ["lightsail-connect"]}
        with patch("firewall_access.urllib.request.urlopen", return_value=io.BytesIO(b"198.51.100.20\n")), patch("firewall_access.ssh_access", return_value=public):
            with self.assertRaisesRegex(ValueError, "internet"):
                firewall_access.open_access("upsolve-aryan", self.state, "100-1")
        self.assertFalse(os.path.exists(self.state))

    def test_refuses_cleanup_after_operator_changes_rules(self):
        prior = {"cidrs": ["203.0.113.8/32"], "ipv6Cidrs": [], "cidrListAliases": []}
        current = {**prior, "cidrs": ["198.51.100.20/32", "203.0.113.8/32", "192.0.2.9/32"]}
        Path(self.state).write_text(json.dumps({"instance": "upsolve-aryan", "cidr": "198.51.100.20/32", "previousAccess": prior, "runId": "100-1"}))
        with patch("firewall_access.ssh_access", return_value=current), patch("firewall_access.aws") as aws:
            with self.assertRaisesRegex(ValueError, "changed"):
                firewall_access.close_access("upsolve-aryan", self.state)
        aws.assert_not_called()

    def test_cleanup_accepts_only_the_main_deployment_workflow(self):
        artifact = {"name": "firewall-123-2"}
        run = {
            "id": 123,
            "path": ".github/workflows/deploy.yml",
            "head_branch": "main",
            "event": "push",
            "repository": {"full_name": "Aryan886/Upsolve"},
        }
        state = {"runId": "123-2"}
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "Aryan886/Upsolve"}):
            for path in (".github/workflows/deploy.yml", ".github/workflows/deploy.yml@main", ".github/workflows/deploy.yml@refs/heads/main"):
                reconcile_firewall.validate_artifact(artifact, {**run, "path": path}, state)
            with self.assertRaisesRegex(ValueError, "main deployment workflow"):
                reconcile_firewall.validate_artifact(artifact, {**run, "head_branch": "beta"}, state)
            with self.assertRaisesRegex(ValueError, "main deployment workflow"):
                reconcile_firewall.validate_artifact(artifact, {**run, "path": ".github/workflows/deploy.yml@beta"}, state)
            with self.assertRaisesRegex(ValueError, "artifact attempt"):
                reconcile_firewall.validate_artifact(artifact, run, {"runId": "123-1"})


if __name__ == "__main__":
    unittest.main()
