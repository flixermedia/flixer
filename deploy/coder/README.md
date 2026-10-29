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

In the workspace the indexer and streamer run inside it, so `indexer` and `streamer` resolve to `127.0.0.1` (added to
`/etc/hosts` by the setup script) and default to `localhost`, while Postgres and Redis resolve as `postgres` and `redis`. The setup wizard pre-fills these, and administrators can change all four addresses
under Admin → Settings → Connections.

The workspace image has Node 26, Go 1.26, ffmpeg and the psql/redis CLIs. Postgres and Redis run as sidecar
containers on a per-workspace Docker network. Project repositories are stored in the Docker host's projects folder
(default `/home/coder/projects`) and bind-mounted into the workspace at `~/projects`. The workspace and Postgres share
the persistent data volume mounted at `~/projects/flixer-data` and `/data`, respectively; PostgreSQL stores its files
under `database/`.

## Use

Requires a Coder deployment with Docker access on the provisioner host.

```sh
cd deploy/coder
coder templates push flixer-dev --directory .
```

Then create a workspace from `flixer-dev`. On every start it clones the five repos into `~/projects`, writes a `.env`
in each (random `JWT_SECRET`/`APP_SECRET`, wired to the local Postgres/Redis), runs `npm ci` / `go mod download`
when needed and starts the services. Existing `.env` files are never overwritten, so add provider keys
(`TMDB_API_KEY`, `DISCOGS_TOKEN`, ...) there.
The startup script also repairs ownership of `~/projects` and `~/projects/flixer-data` on persistent volumes.

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
- **Projects folder on the Docker host**: absolute host path bind-mounted at `~/projects` in the workspace (default `/home/coder/projects`). Repositories, edits, and clones are stored directly in this folder.
- **Public URL**: the browser address of the Flixer app, used for passkeys and links. Coder's app URL looks like
  `https://web--<agent>--<workspace>--<owner>.<wildcard-domain>`; it needs a wildcard access URL on your deployment.
  After changing it, update `APP_URL`, `FLIXER_PUBLIC_URL`, `PASSKEY_RP_ID` and `PASSKEY_ORIGINS` in `~/projects/flixer/.env`
  and run `flixer-stack restart api`. Empty means `http://localhost:5173`.
- **Media folder on the Docker host**: optional read-only mount at `/media`. Create libraries from it in the admin dashboard.
  Otherwise use `~/projects/flixer-data/media`. The API, streamer and indexer use
  `DATA_DIR=~/projects/flixer-data` (services inherit it as `DATA_PATH`), so config, avatars, media cache and backups all stay under that root.

The projects bind mount hides any existing `~/projects` contents in the workspace's persistent home volume. Move or back
up changes you need from that old folder before switching to a host path that does not already contain them.
## Notes

- The Vite dev server uses a self-signed certificate, so the Coder app points at `https://localhost:5173`.
- The indexer watches library folders, which only works for paths inside the workspace; mounted network shares need `WATCH_RESCAN_INTERVAL`. The setup script points both the indexer and streamer at `~/projects/flixer-data/cache/trickplay`; the Vite proxy routes `/trickplay` to the streamer.
- Not validated with `terraform validate`/`coder templates push` yet (no Terraform on the authoring machine).
