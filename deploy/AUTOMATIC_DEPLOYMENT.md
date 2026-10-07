# GitHub deployment for the existing Lightsail server

This is the operator setup for [the implementation plan](../AUTOMATIC_DEPLOYMENT_PLAN.md). The existing server's backup, access and supervised release/recovery checks passed on October 7; [the release checklist](RELEASE_CHECKLIST.md#automatic-deployment-rollout-2026-10-07) records the actual results. For a new installation, keep `AUTO_DEPLOY_ENABLED=false` until those checks pass. A green build alone does not mean the live site changed.

The server remains Amazon Linux 2023 with Caddy, one `cp-notes.service`, and SQLite at `/var/lib/cp-notes/cp-notes.db`. The worker builds nothing on the server. It receives a Linux archive from GitHub, verifies it, tests a private database copy, stops the app for a final SQLite-aware backup and S3 round trip, then switches `/opt/cp-notes/current`. The current manual [Lightsail runbook](LIGHTSAIL_RUNBOOK.md) remains the recovery procedure.

## 1. Confirm the live prerequisites

From an operator session, confirm the actual instance architecture is x86_64, Node is 22.23.3, the Lightsail instance ARN and region, a static public IP, the active release/schema, available disk space, and a working restricted SSH rule. The build workflow pins the Amazon Linux 2023 container index digest in `.github/workflows/deploy.yml`; update and reverify it deliberately when the host/runtime changes. Keep the application port private.

Complete the [private S3 backup setup](README.md#private-s3-backups): a private encrypted bucket, the daily upload timer, and a downloaded backup restored into an independent database with the matching release. A pre-release backup must use a distinct `pre-release/` prefix with deliberate retention. Apply [pre-release-backup-policy.json](pre-release-backup-policy.json) to a separate upload-and-read credential used only by the deployment unit. Its `GetObject` permission is needed for the server's download/checksum verification; the daily uploader can keep its narrower existing policy. Do not put these credentials in GitHub.

The existing server's backup unit was documented as uninstalled on October 3. Confirm its actual state rather than relying on that historical status. The worker pauses an active timer and waits for an active backup service before stopping the app.

## 2. Install the server worker once

Copy the reviewed `deploy/` worker files from the same trusted commit to the server through your existing operator access. Install them **outside** the release directories so an uploaded candidate cannot replace the privileged deployment code. Use root-owned mode `0644` for `.mjs`/`.py`/`.service` files and `0755` for `cp-notes-start-deploy` and its parent directories.

The required installed paths are:

| Source | Installed path |
| --- | --- |
| `deploy/deploy-release.mjs` | `/usr/local/libexec/cp-notes/deploy-release.mjs` |
| `deploy/check-release.mjs` | `/usr/local/libexec/cp-notes/check-release.mjs` |
| `deploy/extract-release.py` | `/usr/local/libexec/cp-notes/extract-release.py` |
| `deploy/cp-notes-start-deploy` | `/usr/local/sbin/cp-notes-start-deploy` |
| `deploy/cp-notes-deploy@.service` | `/etc/systemd/system/cp-notes-deploy@.service` |
| `deploy/cp-notes-deploy.sudoers` | `/etc/sudoers.d/cp-notes-deploy` (`0440`) |

Create a dedicated Linux account named `cp-notes-deploy`, with a normal SSH shell and no application/database ownership. It needs a private `~/.ssh/authorized_keys` containing only the dedicated GitHub deployment public key. Restrict that key with OpenSSH's `restrict` option, and keep the private half in the GitHub `production` environment secret `DEPLOY_SSH_PRIVATE_KEY`. The account needs a writable upload directory at `/var/lib/cp-notes-deploy/uploads` (owner `cp-notes-deploy`, mode `0700`). Its parent and the `state` directory must be root-owned `0755`; worker status files contain no credentials or note content and are readable by the deployment account. Only the root-owned wrapper may start the deployment service through the validated sudoers rule. Run `visudo -cf /etc/sudoers.d/cp-notes-deploy` and `systemctl daemon-reload` after installing the files. Do not enable the template service; it starts per release.

Create `/etc/cp-notes/deploy.env`, root-owned mode `0600`, with these server-only settings:

```dotenv
PRE_RELEASE_S3_URI=s3://YOUR_PRIVATE_BUCKET/pre-release
AWS_DEFAULT_REGION=YOUR_REGION
AWS_ACCESS_KEY_ID=PRE_RELEASE_UPLOADER_KEY
AWS_SECRET_ACCESS_KEY=PRE_RELEASE_UPLOADER_SECRET
AWS_EC2_METADATA_DISABLED=true
```

The deployment unit also loads the existing `/etc/cp-notes/app.env` for `APP_ORIGIN`. Do not move the database, secrets or backups into a release directory. Check the installed service's `ReadWritePaths` and run an initial status/backup exercise before a live activation. If the server uses another Node or Python location, update the root-owned worker and test it before enabling automation.

## 3. Configure GitHub and AWS once

Create the GitHub `production` environment and restrict deployments to `main`. Protect `main` with the available review and status-check rules. Configure these values:

| Scope | Name | Meaning |
| --- | --- | --- |
| Repository variable | `AUTO_DEPLOY_ENABLED` | Start at `false`; change to `true` only after the supervised release |
| Repository variable | `VITE_BACKEND_URL` | `https://upsolve-aryan.duckdns.org/api` |
| Repository variable | `VITE_FEEDBACK_URL` | Reviewed HTTPS feedback form URL |
| Repository variable | `VITE_EXTENSION_ID` | Published 32-letter Chrome extension ID |
| Repository variable | `VITE_EXTENSION_INSTALL_URL` | Published Chrome Web Store install URL |
| Repository variable | `VITE_EXTENSION_KEY` | Optional public manifest key, if used |
| Repository variable | `AWS_REGION` | Region containing the Lightsail instance |
| Repository variable | `LIGHTSAIL_INSTANCE` | Exact Lightsail instance name |
| Repository variable | `CLEANUP_ROLE_ARN` | OIDC role with read/close firewall rights for scheduled cleanup |
| Production variable | `DEPLOY_ROLE_ARN` | OIDC role with read/open/close rights on this one instance |
| Production variable | `DEPLOY_SSH_USER` | `cp-notes-deploy` |
| Production variable | `DEPLOY_SSH_HOST` | Static host DNS name or IPv4 address |
| Production secret | `DEPLOY_SSH_PRIVATE_KEY` | Dedicated OpenSSH private key |
| Production secret | `DEPLOY_HOST_KEY` | Full pinned `known_hosts` line, verified through an independent operator session |

Use [github-deploy-trust.json](github-deploy-trust.json), [github-deploy-policy.json](github-deploy-policy.json), [github-cleanup-trust.json](github-cleanup-trust.json), and [github-cleanup-policy.json](github-cleanup-policy.json) as templates. Replace every placeholder with the real account, region, exact instance ARN, and the **observed** GitHub OIDC subject. The deployment job uses the `production` environment, so its subject differs from a plain branch job. Limit the cleanup role to the default `main` branch and read/close permissions. Neither role needs database or S3 access. [AWS requires](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html) `Resource: "*"` for `GetInstancePortStates`; the write calls remain scoped to the exact instance ARN. The workflow code enforces TCP 22 and the runner's IPv4 `/32`; the IAM instance restriction alone does not limit the selected port.

Production now follows the repository's default `main` branch, as requested on October 7. Both workflows and their dependencies must be committed to `main`: GitHub requires manual-dispatch workflows on the default branch and runs scheduled workflows there. Deployment and cleanup both require the selected `main` ref. Confirm both manual UI paths and a cleanup run succeed. If the production/default branch changes, update the workflow conditions, environment branch restriction and cleanup trust subject together.

Standard GitHub runners change IPs. The deploy job records the existing SSH rules, adds its own `/32`, transfers the release using a pinned host key, and closes its rule afterward. Cleanup examines finished runs with recorded firewall state after two hours; it refuses to alter rules if the firewall changed unexpectedly. If a runner stops between opening its rule and uploading the state artifact, the rule may need manual removal. Check the Lightsail firewall after any abruptly terminated run. Keep operator SSH access separate and restricted.

## 4. Supervised first deployment

1. Keep `AUTO_DEPLOY_ENABLED=false` and run PR checks. The `build` job on a `main` push packages a release but does not deploy while this variable is false.
2. Choose the `main` ref in the **Verify and deploy CP Notes** workflow's manual run UI, select `deploy`, and optionally provide the full desired commit SHA. The job checks that it belongs to `main`.
3. Watch the action summary and server status. Confirm the exact SHA in `/release.json`, HTTPS health, signed-out `/privacy`, Google verification, ordinary website login, published-extension capture, search/edit and two-user isolation.
4. Check that the final pre-release backup was uploaded and downloaded with a matching SHA-256, the original notes/accounts remain, and the backup timer returned to its prior state. Test an independent restore using the matching release; do not test on the live file.
5. Test a compatible rollback using the manual `rollback` operation and an installed release name written by a successful automated deployment. The October 3 legacy release has no automated release manifest, so it remains an internal failure fallback but is not selectable through this manual action.
6. Review Actions minutes, S3 charges and the cleanup workflow. After the supervised checks pass, set `AUTO_DEPLOY_ENABLED=true`, then push an ordinary compatible change and verify that push reaches the live site.

Database migrations require the manual `migrate` operation and an exact reviewed commit. This is explicit because the previous binary may reject the newer schema. The worker checks the migration on copies and uploads a pre-release backup, but it does not restore old data automatically. Replacing `/etc/cp-notes/app.env`, Caddy, Node, systemd units, IAM policies, or Chrome Web Store packages remains a separate reviewed operation.

## 5. Normal operation and recovery

For ordinary compatible changes, push to `main`, then check the Actions result. The job skips a push superseded by a newer `main` head. Each release has a unique full-SHA/run/attempt name and a checksum. The server keeps old releases and pre-release backups for recovery. It never deletes those automatically; inspect disk usage and retain or remove an exact unused release only after checking `current`, status records and backup compatibility.

Use the manual `status` operation with the full worker instance name after a network interruption. Deployments use `deploy-<full-sha>-<build-run-id>-<build-attempt>`. Rollbacks use `rollback-<installed-release-name>-<rollback-run-id>-<rollback-attempt>`, giving each selection a separate status record. A failed job can mean the candidate never activated, the previous release restarted, code rollback succeeded, or manual recovery is required; read its state before starting another operation. The worker blocks a new activation if an earlier state is still marked `running`. The manual Lightsail runbook explains database restore when a schema migration prevents code rollback. Restoring an older database can lose newer notes or revive old sessions/invitations, so it is never automatic.

If an SSH host-key mismatch occurs, stop and verify the actual host key through the operator's independent access path. Do not disable host-key checking. Rotate the deployment key if exposed and update the GitHub secret. A normal website deployment does not publish a new Chrome extension version.

The local release checks use temporary accounts and databases. They do not prove the production server, S3 bucket, GitHub environment or firewall is configured. Record the first successful live run, backup restore and recovery test in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
