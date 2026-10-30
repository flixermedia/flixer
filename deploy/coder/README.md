# Coder template: full Flixer dev stack

A [Coder](https://coder.com) template that gives each workspace the whole stack:

| Service | Where | Port |
|---|---|---|
| flixer API (`npm start`) | workspace | 8083 |
| flixer-streamer (`go run`) | workspace | 8091 |
| flixer-indexer (`go run`) | workspace | 8092 |
| flixer-web (Vite dev server, HTTPS) | workspace | 5173 |
| flixer-docs (Docusaurus dev server, **Flixer Docs** app) | workspace | 3000 |
| PostgreSQL 16 | sidecar container (`postgres`) | 5432 |
| Redis 7 | sidecar container (`redis`) | 6379 |
| Meilisearch 1.12 | sidecar container (`meilisearch`) | 7700 |
| Tailscale | sidecar sharing the workspace network | tailnet |
| SMB | sidecar sharing the Tailscale network | 445 |

In the workspace the indexer and streamer run inside it, so `indexer` and `streamer` resolve to `127.0.0.1` (added to
`/etc/hosts` by the setup script) and default to `localhost`, while Postgres and Redis resolve as `postgres` and `redis`. The setup wizard pre-fills these, and administrators can change all four addresses
under Admin → Settings → Connections.

The workspace image has Node 26, Go 1.26, ffmpeg and the psql/redis CLIs. Postgres, Redis, and Meilisearch run as
sidecars on a per-workspace Docker network. Meilisearch uses the same `APP_SECRET` that Flixer publishes for the
streamer, and its index is persisted in its own Docker volume. Tailscale joins each workspace to your tailnet, and an
authenticated SMB share exposes `~/projects` to tailnet devices. Project repositories are stored in the persistent
workspace home volume mounted at `~/projects`. The workspace and Postgres share the persistent data volume mounted at
`~/projects/flixer-data` and `/data`, respectively; PostgreSQL stores its files under `database/`.

## Use

Requires a Coder deployment with Docker access on the provisioner host.

```sh
cd deploy/coder
coder templates push flixer-dev --directory .
```

Then create a workspace from `flixer-dev`. On every start it clones the five repos into `~/projects`, writes a `.env`
in each (random `JWT_SECRET`/`APP_SECRET`, wired to the local Postgres/Redis/Meilisearch), runs `npm ci` / `go mod download`
when needed and starts the services. Existing `.env` files keep provider keys (`TMDB_API_KEY`, `DISCOGS_TOKEN`, ...);
the startup script maintains Flixer's managed service URLs.
The startup script repairs ownership and tracked file modes in existing repository trees on the persistent projects volume
once per workspace user. It deliberately does not recurse into `flixer-data`, which can contain large media libraries.
Set the `tailscale_auth_key` and `smb_password` sensitive template variables in Coder before creating a workspace.
For an initial template push, use `coder templates push flixer-dev --directory . --variables-file /secure/path/flixer-coder.tfvars`
with a protected variables file kept outside the repository rather than putting secrets in shell history.

Open the **Flixer** app in the workspace page. Manage services from the terminal:

```sh
flixer-stack status
flixer-stack restart indexer
flixer-stack logs api        # logs are in ~/logs/<service>.log
```

## GitHub access

The template uses Coder's GitHub external authentication: `git` authenticates through the agent's credential helper and `gh`
reads `GH_TOKEN`, both as the GitHub account linked to the workspace owner. The Coder deployment needs a GitHub provider
(`CODER_EXTERNAL_AUTH_0_ID=github`, `CODER_EXTERNAL_AUTH_0_TYPE=github`, plus client ID and secret). On first workspace
creation Coder prompts the owner to link their account. Commits use the owner's Coder name and email. Check with `gh auth status`.

## Parameters

- **Git base URL**: where the repos are cloned from (default `https://github.com/flixermedia`). Private repos use Coder's git authentication.
- **Tailscale auth key**: required sensitive template variable `tailscale_auth_key`. It joins each active workspace to your tailnet as its own node. The Tailscale state persists across workspace restarts. Create a reusable auth key with only the access and lifetime you need; the Coder Docker host must provide `/dev/net/tun` and permit the `NET_ADMIN`/`NET_RAW` capabilities.
- **SMB password**: required sensitive template variable `smb_password`. Connect as user `coder` to `\\<workspace-tailnet-name>\projects` (Windows) or `smb://<workspace-tailnet-name>/projects` (macOS). If the name does not resolve, use the workspace's Tailscale IP instead, or enable MagicDNS and use the exact DNS name shown in the Tailscale admin console.
- **Public URL**: the browser address of the Flixer app, used for passkeys and links. Coder's app URL looks like
  `https://web--<agent>--<workspace>--<owner>.<wildcard-domain>`; it needs a wildcard access URL on your deployment.
  After changing it, update `APP_URL`, `FLIXER_PUBLIC_URL`, `PASSKEY_RP_ID` and `PASSKEY_ORIGINS` in `~/projects/flixer/.env`
  and run `flixer-stack restart api`. Empty means `http://localhost:5173`.
- **Media folder on the Docker host**: optional read-only mount at `/media`. Create libraries from it in the admin dashboard.
  Otherwise use `~/projects/flixer-data/media`. The API, streamer and indexer use
  `DATA_DIR=~/projects/flixer-data` (services inherit it as `DATA_PATH`), so config, avatars, media cache and backups all stay under that root.

If you previously used the Docker host projects folder, it is no longer mounted and its contents are not migrated.
They remain on the host; separately copy or back up anything you need before applying this change.

The SMB service mounts the same persistent home and data volumes as the workspace and forces file operations to UID/GID 1000
(`coder`). Newly created files retain owner read/write/execute permissions, and directories retain owner
read/write/execute permissions, so the workspace user can continue working with them. The SMB service shares the
Tailscale network namespace and does not publish port 445 on the Docker host. It listens on the shared namespace's
interfaces; tailnet access is subject to your Tailscale ACLs, and SMB still requires the separate `coder` password.

Sensitive template variables are redacted in Coder interfaces, but Docker container configuration and Terraform state
can contain the Tailscale auth key and SMB password. Treat access to the Coder deployment, provisioner host, and
Terraform state as access to these credentials.

## Notes

- The Vite dev server uses a self-signed certificate, so the Coder app points at `https://localhost:5173`.
- The indexer watches library folders, which only works for paths inside the workspace; mounted network shares need `WATCH_RESCAN_INTERVAL`. The setup script points both the indexer and streamer at `~/projects/flixer-data/cache/trickplay`; the Vite proxy routes `/trickplay` to the streamer.
- The Tailscale Docker host must provide `/dev/net/tun` and allow the required network capabilities.
