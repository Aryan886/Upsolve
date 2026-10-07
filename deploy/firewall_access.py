#!/usr/bin/env python3
"""Grant one GitHub runner temporary SSH access to the Lightsail instance."""

import ipaddress
import json
import os
import subprocess
import sys
import urllib.request


def aws(*arguments):
    result = subprocess.run(["aws", "lightsail", *arguments, "--output", "json"], check=True, text=True, capture_output=True)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def port_states(instance):
    return aws("get-instance-port-states", "--instance-name", instance)["portStates"]


def ssh_access(instance):
    access = {"cidrs": [], "ipv6Cidrs": [], "cidrListAliases": []}
    for state in port_states(instance):
        if state["protocol"] in ("tcp", "all") and state["fromPort"] <= 22 <= state["toPort"]:
            for name in access:
                access[name].extend(state.get(name, []))
    return access


def matches_access(actual, expected):
    return all(set(actual[name]) == set(expected[name]) for name in expected)


def port_info(cidr):
    return json.dumps({"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrs": [cidr]}, separators=(",", ":"))


def write_state(path, state):
    temporary = path + ".partial"
    with open(temporary, "x", encoding="utf-8") as output:
        json.dump(state, output)
        output.write("\n")
    os.replace(temporary, path)


def open_access(instance, state_path, run_id):
    if os.path.exists(state_path):
        raise ValueError("Firewall state file already exists")
    with urllib.request.urlopen("https://checkip.amazonaws.com", timeout=15) as response:
        address = ipaddress.IPv4Address(response.read().decode().strip())
    cidr = f"{address}/32"
    previous = ssh_access(instance)
    if any(ipaddress.ip_network(value, strict=False).prefixlen == 0 for name in ("cidrs", "ipv6Cidrs") for value in previous[name]):
        raise ValueError("SSH is already open to the internet over IPv4 or IPv6; restrict operator access before deploying")
    if set(previous["cidrListAliases"]) - {"lightsail-connect"}:
        raise ValueError("SSH has an unrecognized firewall alias")
    if cidr in previous["cidrs"]:
        raise ValueError("Runner address already has an SSH rule; refusing to claim it")
    state = {"instance": instance, "cidr": cidr, "previousAccess": previous, "runId": run_id}
    write_state(state_path, state)
    aws("open-instance-public-ports", "--instance-name", instance, "--port-info", port_info(cidr))
    if cidr not in ssh_access(instance)["cidrs"]:
        raise ValueError("Runner SSH rule was not visible after opening it")
    print(f"Temporary SSH access ready for run {run_id}")


def close_access(instance, state_path):
    with open(state_path, encoding="utf-8") as source:
        state = json.load(source)
    if state["instance"] != instance:
        raise ValueError("Firewall state belongs to a different Lightsail instance")
    cidr = state["cidr"]
    ipaddress.IPv4Network(cidr, strict=True)
    current = ssh_access(instance)
    previous = state["previousAccess"]
    if cidr in previous["cidrs"]:
        raise ValueError("Refusing to remove an SSH rule that existed before this deployment")
    if cidr not in current["cidrs"]:
        print(f"Temporary SSH access for run {state['runId']} is already closed")
        return
    expected = {**previous, "cidrs": [*previous["cidrs"], cidr]}
    if not matches_access(current, expected):
        raise ValueError("SSH rules changed during deployment; inspect them before removing any rule")
    aws("close-instance-public-ports", "--instance-name", instance, "--port-info", port_info(cidr))
    if cidr in ssh_access(instance)["cidrs"]:
        raise ValueError("Temporary SSH rule is still present")
    print(f"Temporary SSH access closed for run {state['runId']}")


if __name__ == "__main__":
    try:
        if len(sys.argv) == 5 and sys.argv[1] == "open":
            open_access(sys.argv[2], sys.argv[3], sys.argv[4])
        elif len(sys.argv) == 4 and sys.argv[1] == "close":
            close_access(sys.argv[2], sys.argv[3])
        else:
            raise ValueError("Usage: firewall-access.py open INSTANCE STATE RUN_ID | close INSTANCE STATE")
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Firewall operation failed: {error}", file=sys.stderr)
        sys.exit(1)
