#!/usr/bin/env bash
set -euo pipefail

operation=${1:-}
release_name=${2:-}
[[ $operation =~ ^(deploy|migrate|rollback|status)$ ]] || { echo "Invalid operation" >&2; exit 2; }
[[ $release_name =~ ^[a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4}$ || ( $operation == status && $release_name =~ ^(deploy|migrate|rollback)-[a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4}$ ) ]] || { echo "Invalid release name" >&2; exit 2; }
[[ ${DEPLOY_SSH_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ ${DEPLOY_SSH_HOST:-} =~ ^[A-Za-z0-9.-]+$ ]]
[[ -f ${DEPLOY_SSH_KEY_FILE:-} && -f ${DEPLOY_KNOWN_HOSTS_FILE:-} ]]

ssh_options=(-i "$DEPLOY_SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS_FILE" -o ConnectTimeout=10)
destination="${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}"
if [[ $operation == status ]]; then
  instance=$release_name
  ssh "${ssh_options[@]}" "$destination" "cat /var/lib/cp-notes-deploy/state/${instance}.json"
  exit
fi

instance="${operation}-${release_name}"
if [[ $operation == deploy || $operation == migrate ]]; then
  archive="${RELEASE_OUTPUT_DIRECTORY:-release-artifacts}/${release_name}.tar.gz"
  [[ -f $archive && -f $archive.sha256 ]] || { echo "Release archive is missing" >&2; exit 1; }
  scp "${ssh_options[@]}" "$archive" "$archive.sha256" "$destination:/var/lib/cp-notes-deploy/uploads/"
fi

ssh "${ssh_options[@]}" "$destination" "sudo -n /usr/local/sbin/cp-notes-start-deploy ${instance}"
for attempt in {1..120}; do
  if status=$(ssh "${ssh_options[@]}" "$destination" "cat /var/lib/cp-notes-deploy/state/${instance}.json" 2>/dev/null); then
    printf '%s\n' "$status" > "${DEPLOY_STATUS_FILE:-deployment-status.json}"
    state=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' <<< "$status")
    case $state in
      complete) echo "Deployment completed: $instance"; exit 0 ;;
      failed) echo "Deployment failed: $instance" >&2; exit 1 ;;
      running) ;;
      *) echo "Unknown deployment state" >&2; exit 1 ;;
    esac
  fi
  if ssh "${ssh_options[@]}" "$destination" "systemctl is-failed --quiet cp-notes-deploy@${instance}.service" 2>/dev/null; then
    echo "Deployment unit failed before recording a status; inspect the server journal" >&2
    exit 1
  fi
  sleep 15
done
echo "Deployment outcome is unknown: inspect $instance before retrying" >&2
exit 1
