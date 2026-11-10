<div align="center">

<img src="https://raw.githubusercontent.com/flixermedia/flixer/main/resources/logo/flixer-logo.png" alt="Flixer logo" width="112" />

# Flixer

**Your media, your server, your rules.**

[Install Flixer](https://get.flixer.dev) · [Documentation](https://docs.flixer.dev) · [Report an issue](https://github.com/flixermedia/flixer/issues) · [Features](FEATURES.md)

</div>

Flixer is a self-hosted media platform for organizing and streaming your own
movies, shows and other media. This repository provides the main backend and
the installer for the full stack.

> [!WARNING]
> Flixer is under active development. Components and integration contracts may
> change; review release notes and back up your data before upgrading.

## What can Flixer do?

- Manage media libraries, users and server settings from a web interface.
- Scan and organize media, then stream it through the Flixer web app.
- Set up your server and first administrator with a guided wizard.
- Use local media folders or supported network shares.
- Optionally enable AI recommendations and audio/video calls. Payments are
  disabled by default; see the
  [payments guide](https://docs.flixer.dev/flixer/payments/overview-and-concepts).

## Install Flixer

Use the official installer at [get.flixer.dev](https://get.flixer.dev). It
downloads the current Compose files, guides you through installation choices,
and starts the Flixer stack.

### macOS and supported Linux

Install Docker and Docker Compose. On Debian and Ubuntu the installer can
install Docker for you. Then run:

```bash
curl -fsSL https://get.flixer.dev | bash
```

Follow the prompts to choose your installation, data and media folders. The
installer can also configure an SMB share.

### Windows

The Windows installer runs Flixer inside WSL 2 using a local Docker Engine
installed inside the Linux distribution. Docker Desktop is not supported by
this installer.

Install Ubuntu if needed, then install and start Docker Engine and Compose
inside WSL. Run the installer from PowerShell:

```powershell
wsl --install -d Ubuntu
Invoke-WebRequest -UseBasicParsing https://get.flixer.dev/install.ps1 -OutFile install-flixer.ps1
powershell -ExecutionPolicy Bypass -File .\install-flixer.ps1
```

See [get.flixer.dev](https://get.flixer.dev) for current options. Windows
install paths are Linux paths inside WSL; Windows drives are available through
paths such as `/mnt/c/Media` when WSL and Docker can access them.

### Finish setup

1. Open the address printed by the installer (default `http://localhost:8080`).
2. Follow the setup wizard to connect a database and create your administrator
   account. The standard installation includes PostgreSQL and Redis.
3. Add your media libraries.

AI is enabled by default for new installations and may download models. You
can turn it off during setup or use the installer's `--no-ai` option on macOS
and Linux, or `-NoAi` on Windows. Existing configuration is preserved when
updating.

## Flixer ecosystem

The standard self-hosted stack includes the API, web app, streamer, indexer,
PostgreSQL, Redis, Meilisearch, Logger, and updater. AI recommendations and
TURN relay for calls are optional Compose services. Plugins are installed
through Flixer; Flixer Cloud is a separate website and is not required to run
the self-hosted server.

See the [ecosystem guide](https://docs.flixer.dev/ecosystem) for the full
repository list and what each project does.

## Manage your server

The installer provides a management menu for starting, stopping, restarting and
updating Flixer or checking its status. Docker must be running first.

**macOS/Linux:** Run this from your installation directory:

```bash
./manage.sh
```

You can also pass an action, for example `./manage.sh restart` or
`./manage.sh status`.

**Windows:** Open PowerShell and run:

```powershell
powershell -ExecutionPolicy Bypass -File "$HOME\flixer-management\manage.ps1"
```

You can append `start`, `stop`, `restart`, `update` or `status` to either
management command. Stopping Flixer does not delete your data.

### Updates and backups

For version selection, database backup and rollback, use **Admin > Updates**.
The installer and management script can also pull the currently configured
image tags and recreate services, but they do not back up the database, change
pinned versions or replace the Compose file. Back up persistent data before
major changes.

The installer offers **update** or **fresh**:

| Choice | What happens |
| --- | --- |
| **Update** | Keeps the existing `.env`, Compose files and data; pulls configured images and starts services. |
| **Fresh** | Starts a new installation. For an existing installation, it first asks for confirmation and backs up the old data directory. |

For unattended use, select `--update` or `--fresh` on macOS/Linux, or `-Update`
or `-Fresh` on Windows. `--no-start` / `-NoStart` pulls update images without
starting services.

> [!IMPORTANT]
> A confirmed fresh reset stops the old stack and moves `DATA_DIR`, including
> the standard bundled PostgreSQL database, to a sibling
> `*.flixer-backup-*` directory. It saves the old `.env` and Compose file beside
> the backup and uses a new Compose project; old named volumes remain. Backups
> continue to use disk space.
>
> Media and external PostgreSQL databases are **not** reset. Choose a new or
> empty external database during setup. Custom database or volume locations
> outside `DATA_DIR` are also left untouched. The installer refuses unsafe or
> incomplete layouts, including overlapping media/data paths and mounted data
> directories. A nonempty data directory without an existing installation is
> never reset.
>
> For an unattended reset, explicitly pass `--confirm-reset` or
> `-ConfirmReset`. `--yes` alone does not authorize a reset.

## Where is my data?

| Location | Contents |
| --- | --- |
| `DATA_DIR` | Flixer settings, the bundled PostgreSQL database, cache, avatars, backups, logs and other application data. |
| `MEDIA_PATH` | Your media library root. Choose folders inside it when creating libraries. |
| `DATA_DIR/meilisearch` | The bundled Meilisearch search index. |
| `DATA_DIR/logs/logger` | Private Flixer Logger storage. |

The setup wizard stores settings in SQLite; explicitly supplied environment
values take precedence. PostgreSQL stores the main application data. See
[`.env.example`](.env.example) for advanced configuration.

AI can be enabled or disabled later by editing `COMPOSE_PROFILES` in `.env` and
restarting the stack. Disabled services are stopped but their containers are
not removed.

<details>
<summary>Moving from an older Meilisearch Docker volume</summary>

Older macOS installs may use a `meilisearch-data` Docker volume. After switching
to the current Compose file, Meilisearch uses `DATA_DIR/meilisearch` and Flixer
queues a rebuild of the empty index from the media database. The old volume is
not copied or deleted; keep it until you have verified search. Remove the
obsolete `MEILISEARCH_STORAGE` setting from `.env`. The installer update command
does not replace existing Compose files, so update the Compose file separately.

On macOS, Docker Desktop bind-mount filesystem limitations may prevent
Meilisearch from starting on some host filesystems. Check its container logs
and use a `DATA_DIR` on a compatible filesystem if necessary.

</details>

## Troubleshooting

- **Setup cannot continue after the database step:** Redis must be reachable
  before the full API can start. Check the Redis service and its connection
  settings, then retry. Older incomplete quick setups are repaired at API
  startup without replacing an existing Redis setting.
- **Search reports an authentication error:** Check the Meilisearch key and
  permissions. The bundled service reads the shared application secret at
  startup; after changing it, restart the services listed by the setup wizard,
  including Meilisearch. Do not remove search data or application secrets as
  a troubleshooting step.
- **Need logs?** From the installation directory, run `docker compose logs -f`
  or add a service name, such as `docker compose logs -f logger`.

For other problems, consult the [documentation](https://github.com/flixermedia/flixer-docs)
or [open an issue](https://github.com/flixermedia/flixer/issues) with the
relevant error and steps to reproduce it. Do not include passwords or secrets.

<details>
<summary>Nginx template errors</summary>

If `nginx-config-init` reports a missing Nginx template, refresh the images:

```bash
docker compose down
docker compose pull
docker compose up -d
```

If you must use an older image, first update your Compose file from the
[current version](docker-compose.yml), preserving local changes. Place the
[Nginx configuration](deploy/proxy/nginx.conf) at
`DATA_DIR/nginx/nginx.conf`, then run `docker compose up -d` again. The
initializer uses that file only when the image lacks a template; otherwise it
replaces it with the bundled version.

</details>

## Advanced installation and maintenance

<details>
<summary>Install manually with Docker Compose</summary>

```bash
mkdir -p flixer/deploy/docker && cd flixer
curl -fsSLO https://raw.githubusercontent.com/flixermedia/flixer/main/docker-compose.yml
curl -fsSLo deploy/docker/init-data.sh https://raw.githubusercontent.com/flixermedia/flixer/main/deploy/docker/init-data.sh
printf 'DATA_DIR=/path/to/flixer-data\nMEDIA_PATH=/path/to/media\n' > .env
docker compose up -d
```

`DATA_DIR` maps into containers as `/data`; `MEDIA_PATH` is the host library
root. Set `HTTP_PORT` if needed. Only the reverse proxy should be published to
the host. See [`.env.example`](.env.example) and the [installer source](install.sh)
for more options.

For manual operations:

```bash
docker compose pull && docker compose up -d
docker compose logs -f
docker compose down
```

`docker compose down -v` deletes named volumes; use it with care.

</details>

<details>
<summary>Logging and Logger backups</summary>

The bundled Logger stores events in `DATA_DIR/logs/logger` and is reachable
only internally. It creates a TLS certificate on first startup and pairs using
Flixer's protected owner bootstrap file. Producer credentials are delivered
over Flixer's signed Unix control socket. Configure retention and other
policies under **Admin > Logging**.

Back up this private Logger store by running `docker compose kill -s USR1 logger`
and copying the resulting checkpoint from `DATA_DIR/logs/logger/checkpoints`, or
stop Logger before copying the store. Do not copy only active Pebble files
while Logger is running.

On startup, `data-init` moves legacy entries from `DATA_DIR/logs` to
`DATA_DIR/app-logs`, leaving `logs/logger` in place. It stops rather than
overwriting an existing destination. Flixer, Streamer and Indexer use console
output and Logger rather than application-managed log files.

The Logger image is `ghcr.io/flixermedia/flixer-logger`; `LOGGER_VERSION` can
pin its tag. The updater detects the bundled Logger using
`FLIXER_LOGGER_LOCAL_ENDPOINT` or the local owner bootstrap's loopback default.
AI and Logger updates require stable GitHub releases with matching numeric
image tags. On GitHub API rate limits, release checks use the public latest
release redirect; unavailable releases remain unknown.

</details>

<details>
<summary>Convert existing trickplay cache entries</summary>

To preview and then add HLS image playlists:

```bash
node scripts/convert-trickplay-cache.mjs
node scripts/convert-trickplay-cache.mjs --write
```

The script uses `DATA_DIR` from the environment or `.env` by default, preserves
existing indexes and JPEG sheets, and skips existing playlists unless `--force`
is supplied. Use `--data-dir /path/to/data` to choose another data directory.

</details>

## For contributors

Bug reports, pull requests and documentation improvements are welcome. For
source-based development, clone the sibling services and run
`docker compose -f docker-compose.dev.yml up --build`. See
[FEATURES.md](FEATURES.md), [VERSION.md](VERSION.md) and
[SECURITY.md](SECURITY.md) for additional information.

<details>
<summary>Development and integration test notes</summary>

Watch-party Redis scripts live in [`src/party/lua/`](src/party/lua/) and are
imported as raw text into the API bundle. Keep their `ARGV` positions aligned
with [`partiesService.ts`](src/party/partiesService.ts); run
`npx vitest run src/party/parties.spec.ts` after changes.

The optional Logger correlation test sends two concurrent recommendation
requests to a running AI service and checks trace-indexed events in a real
Logger. Use isolated Logger and AI instances with recommendations disabled.
Securely provide `LOGGER_CORRELATION_URL`, `LOGGER_CORRELATION_INGEST` (an
application-bound `flixer` ingestion credential), `LOGGER_CORRELATION_QUERY`,
`LOGGER_CORRELATION_AI_URL` and `LOGGER_CORRELATION_AI_SECRET`, then run:

```bash
npx vitest run src/api/ai/loggerCorrelationIntegration.spec.ts
```

The test is skipped when these values are absent; it does not provision
services or verify full-stack deployment.

The optional Logger owner test starts a disposable local Logger and checks
owner isolation and capacity rejection/recovery. Build Logger and provide its
binary path:

```bash
cd ../flixer-logger
go build -o /tmp/flixer-logger-test ./cmd/flixer-logger
cd ../flixer
FLIXER_LOGGER_TEST_BINARY=/tmp/flixer-logger-test npx vitest run src/api/logger/loggerOwnerIntegration.spec.ts
```

It is skipped without the binary path and does not exercise Flixer HTTP
authentication, browser-to-API integration or deployment.

</details>

### Flixer ecosystem

The standard self-hosted stack includes the API, web app, streamer, indexer,
Logger, and updater. AI recommendations and the Coturn-based TURN relay for
audio/video calls are optional Compose services. Plugins are installed through
Flixer, while Flixer Cloud is a separate website.

| Repository | Purpose |
| --- | --- |
| [Flixer](https://github.com/flixermedia/flixer) | Backend API, authentication, libraries, and administration. |
| [Flixer Web](https://github.com/flixermedia/flixer-web) | Browsing, sign-in, discovery, and playback interface. |
| [Flixer Streamer](https://github.com/flixermedia/flixer-streamer) | Media delivery and FFmpeg processing. |
| [Flixer Indexer](https://github.com/flixermedia/flixer-indexer) | Media discovery, identification, probing, and enrichment. |
| [Flixer Logger](https://github.com/flixermedia/flixer-logger) | Structured service logs and event search. |
| [Flixer Updater](https://github.com/flixermedia/flixer-updater) | In-dashboard updates, backups, and rollback. |
| [Flixer AI](https://github.com/flixermedia/flixer-ai) | Optional recommendation service. |
| [Flixer Plugins](https://github.com/flixermedia/flixer-plugins) | Official plugin catalogue and schemas. |
| [Flixer Cloud](https://github.com/flixermedia/flixer-cloud) | Independent Flixer-branded marketing and account website. |
| [Flixer Docs](https://github.com/flixermedia/flixer-docs) | Platform documentation. |

See the [ecosystem guide](https://docs.flixer.dev/ecosystem) for which
projects are part of the server installation.

## Licence

Check the applicable licence for each component before redistributing it.
