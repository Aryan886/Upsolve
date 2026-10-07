#!/usr/bin/env python3
"""Close only positively identified, completed deployment SSH rules."""

import io
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone

from firewall_access import close_access


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def github_json(path):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}{path}",
        headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def download_artifact(artifact_id):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/actions/artifacts/{artifact_id}/zip",
        headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json"},
    )
    try:
        urllib.request.build_opener(NoRedirect()).open(request, timeout=30)
        raise ValueError("Artifact download did not redirect")
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise
        location = error.headers["Location"]
    with urllib.request.urlopen(location, timeout=30) as response:
        archive = response.read(1024 * 1024 + 1)
    if len(archive) > 1024 * 1024:
        raise ValueError("Firewall state artifact is unexpectedly large")
    with zipfile.ZipFile(io.BytesIO(archive)) as files:
        data = files.read("deploy-firewall-state.json")
    if len(data) > 16 * 1024:
        raise ValueError("Firewall state file is unexpectedly large")
    return json.loads(data)


def validate_artifact(artifact, run, state):
    expected_name = re.fullmatch(r"firewall-(\d+)-(\d+)", artifact["name"])
    if not expected_name or int(expected_name.group(1)) != run["id"]:
        raise ValueError("Firewall artifact name differs from workflow run")
    expected_paths = (".github/workflows/deploy.yml@beta", ".github/workflows/deploy.yml@refs/heads/beta")
    if run["path"] not in expected_paths or run["head_branch"] != "beta" or run["event"] not in ("push", "workflow_dispatch"):
        raise ValueError("Firewall artifact did not come from the beta deployment workflow")
    if run["repository"]["full_name"] != os.environ["GITHUB_REPOSITORY"]:
        raise ValueError("Firewall artifact belongs to a different repository")
    if state["runId"] != f"{run['id']}-{expected_name.group(2)}":
        raise ValueError("Firewall state differs from artifact attempt")


def reconcile():
    instance = os.environ["LIGHTSAIL_INSTANCE"]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
    failures = []
    for page in range(1, 11):
        response = github_json(f"/actions/artifacts?per_page=100&page={page}")
        artifacts = response["artifacts"]
        if not artifacts:
            break
        for artifact in artifacts:
            if not artifact["name"].startswith("firewall-") or artifact["expired"]:
                continue
            created = datetime.fromisoformat(artifact["created_at"].replace("Z", "+00:00"))
            if created > cutoff:
                continue
            run = artifact.get("workflow_run")
            if not run:
                failures.append(f"Artifact {artifact['id']} has no workflow run")
                continue
            run_details = github_json(f"/actions/runs/{run['id']}")
            if run_details["status"] != "completed":
                continue
            try:
                state = download_artifact(artifact["id"])
                validate_artifact(artifact, run_details, state)
                if state["instance"] != instance:
                    raise ValueError("Artifact belongs to another Lightsail instance")
                with tempfile.TemporaryDirectory(prefix="cp-notes-firewall-") as directory:
                    path = os.path.join(directory, "state.json")
                    with open(path, "w", encoding="utf-8") as output:
                        json.dump(state, output)
                    close_access(instance, path)
            except (ValueError, OSError, KeyError, urllib.error.URLError) as error:
                failures.append(f"Artifact {artifact['id']}: {error}")
        if len(artifacts) < 100:
            break
    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        raise RuntimeError("One or more firewall rules need manual review")


if __name__ == "__main__":
    try:
        reconcile()
    except Exception as error:
        print(f"Firewall reconciliation failed: {error}", file=sys.stderr)
        sys.exit(1)
