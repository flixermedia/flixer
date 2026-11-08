<div align="center">

<img src="https://raw.githubusercontent.com/flixermedia/flixer/main/resources/logo/flixer-logo.png" alt="Flixer logo" width="112" />

# Flixer

**Your media, your rules, beautifully streamed.**

[![Stars](https://img.shields.io/github/stars/flixermedia/flixer?style=flat-square)](https://github.com/flixermedia/flixer/stargazers) [![Issues](https://img.shields.io/github/issues/flixermedia/flixer?style=flat-square)](https://github.com/flixermedia/flixer/issues)

[Flixer](https://github.com/flixermedia/flixer) · [Documentation](https://github.com/flixermedia/flixer-docs) · [Report an issue](https://github.com/flixermedia/flixer/issues)

</div>

---

> [!WARNING]
> **Under active development.** Flixer components and integration contracts may change. Check current source and release notes before upgrading production installations.

> [!NOTE]
> **Role in Flixer:** The self-hosted backend API, authentication, libraries, and administration service. This is the main install entry point for the full stack.

## ✨ Features

- **Self-hosted control:** Manage users, libraries and settings without a mandatory cloud account.
- **Multi-service architecture:** Coordinate the web client, indexer, streamer and updater.
- **Guided setup:** Configure the server and create the initial administrator account through onboarding.
- **Library management:** Configure local or network-mounted media roots.
- **Configurable settings:** SQLite-backed setup and application settings, with PostgreSQL for the main database.
- **Deployment tooling:** Docker Compose, development stack and one-command installer.
- **Optional payments:** Configure Stripe or Square for scoped media paywalls, rentals, subscriptions, registration fees, coupons, refunds and complimentary grants; disabled by default. See the [payments guide](https://flixermedia.github.io/flixer-docs/docs/flixer/payments/overview-and-concepts).

## 🏗️ Architecture

Flixer separates application logic from its web UI, media indexing, media delivery, update management, plugins and documentation. **Flixer** owns the following responsibility: the self-hosted backend API, authentication, libraries, and administration service.

For the full platform, the API coordinates services; the browser interacts with the backend and the streamer receives authorised playback requests. Components should be operated as part of the supported Flixer stack unless you are developing or testing them directly.

## 🚀 Getting started

### Recommended installation
Review the installer before execution, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/flixermedia/flixer/main/install.sh | bash
```

The Bash installer supports macOS and Linux (automatic Docker installation is supported on Debian/Ubuntu). It launches onboarding at `http://localhost:8080` by default. Quick setup uses the bundled Redis service; advanced setup configures Redis before connecting the database.

On Windows, install a WSL 2 Linux distribution (for example `wsl --install -d Ubuntu`) and install and start [Docker Engine and Compose inside that distribution](https://docs.docker.com/engine/install/ubuntu/). The Windows installer requires the local Linux engine, not Docker Desktop or a remote Docker context, so that the dashboard updater can access the same Linux paths as the daemon. Enable systemd in WSL as needed and make sure your WSL user can run `docker info` without sudo.

Then run in PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/flixermedia/flixer/main/install.ps1 -OutFile install-flixer.ps1
powershell -ExecutionPolicy Bypass -File .\install-flixer.ps1
```

By default this installs into `~/flixer` inside the default WSL distribution. Use `-Distro Ubuntu` to select a distribution, and `-LinuxDir`, `-Data`, or `-Media` to specify absolute Linux paths. Windows drives are accessible under paths such as `/mnt/c/Media`; ensure WSL and Docker can access them. Pass `-NoStart` to write the installation without starting it.

AI is enabled by default for new installs and may download models. Choose no at the installer prompt, or pass `--no-ai` (Bash) / `-NoAi` (PowerShell) for unattended installs. Existing `.env` files are preserved.

The installers offer **fresh** or **update**. Without an explicit choice, they detect an existing installation in the selected directory. For unattended runs use `--fresh` or `--update` (Bash), or `-Fresh` or `-Update` (PowerShell). Fresh installation over an existing installation requires confirmation: it stops the old stack and moves its data directory, including the standard bundled PostgreSQL database, to a sibling `*.flixer-backup-*` directory before creating a new empty data directory. The old `.env` and Compose file are saved beside that backup; the new stack uses a new Compose project, leaving old named volumes intact. These backups continue to use disk space. Media and external PostgreSQL databases are not reset, so choose a new or empty external database during setup. Custom database or volume locations outside the data directory are not reset. The installer refuses overlapping media/data paths, mounted data directories, and other unsafe or incomplete layouts. For unattended reset explicitly add `--confirm-reset` / `-ConfirmReset`; `--yes` alone is not consent. A nonempty data directory without an existing installation is never reset.

Update requires an existing `.env` and Compose file, keeps them and all data unchanged, and pulls the currently configured image tags before starting the services. It does not update the Compose file, select newer pinned versions, back up the database, or provide rollback; use **Admin > Updates** for version selection and backup. `--no-start` / `-NoStart` pulls update images without starting services.

The bundled Meilisearch index is stored in `DATA_DIR/meilisearch` on all platforms. If an older installation used the `meilisearch-data` Docker volume, switching to the new Compose file starts with a separate empty index; Flixer automatically queues a rebuild from the media database. The old volume is not deleted or copied. Keep it until you have verified search, and remove any obsolete `MEILISEARCH_STORAGE` setting from `.env`. The installer's update command does not replace existing Compose files, so existing installations must update their Compose file to switch storage.

On macOS, Docker Desktop bind-mount filesystem limitations may prevent Meilisearch from starting on some host filesystems. If it fails, check the Meilisearch container logs and use a `DATA_DIR` on a filesystem compatible with Meilisearch.

### Manual Docker Compose

```bash
mkdir -p flixer/deploy/docker && cd flixer
curl -fsSLO https://raw.githubusercontent.com/flixermedia/flixer/main/docker-compose.yml
curl -fsSLo deploy/docker/init-data.sh https://raw.githubusercontent.com/flixermedia/flixer/main/deploy/docker/init-data.sh
printf 'DATA_DIR=/path/to/flixer-data\nMEDIA_PATH=/path/to/media\n' > .env
docker compose up -d
```

`DATA_DIR` maps into containers as `/data`; `MEDIA_PATH` is the host library root. Override `HTTP_PORT` when required. See [`.env.example`](.env.example) for advanced settings and [the installer source](install.sh) before running it. Use `docker compose logs -f` to troubleshoot.

## ⚙️ Configuration and operations

- `DATA_DIR` is required for persisted settings, PostgreSQL data, archived compatibility logs (`app-logs`), Logger storage (`logs/logger`), caches, avatars, backups and the bundled Nginx config. On startup, `data-init` migrates existing entries from `DATA_DIR/logs` into `DATA_DIR/app-logs` without moving `logs/logger`; it stops rather than overwriting a colliding destination. Flixer, Streamer and Indexer no longer write application-managed log files; console output remains available through Docker, and Logger connections receive events asynchronously.
- The onboarding wizard stores settings in SQLite; explicitly supplied environment values take precedence.
- PostgreSQL provides application data; Redis supports supporting services.
- Only the reverse proxy should be published to the host by the bundled stack.
- For source-based development, clone sibling services and run `docker compose -f docker-compose.dev.yml up --build`.
- See [`FEATURES.md`](FEATURES.md), [`VERSION.md`](VERSION.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for complete feature, release and contribution details.

## 🧰 Maintenance

The installer downloads management scripts into the install directory. On macOS or Linux, run `./manage.sh` for a menu, or pass `start`, `stop`, `restart`, `update`, or `status` (for example, `./manage.sh update`). On Windows, run `powershell -ExecutionPolicy Bypass -File "$HOME\flixer-management\manage.ps1"` and optionally append one of the same actions. Docker and Compose must be running in the installation's Linux environment.

The update command pulls configured image tags and recreates the stack; it does not back up the database or change pinned versions. Use **Admin > Updates** for version selection, database backup, and rollback. Stopping does not delete data. AI can be enabled or disabled after installation by editing `COMPOSE_PROFILES` in `.env`; restart the stack after changing it. Disabled services are stopped but their containers are not removed.

During setup, Redis must be reachable before the database step starts the full API. Quick setup uses the bundled Redis; advanced setup lets you configure another server. If Redis is unavailable, check the Redis service and its connection settings before retrying. Incomplete quick setups created by older releases are repaired when the API starts, without replacing an existing Redis setting.

The bundled Meilisearch service reads the shared application secret when it starts. If that secret is changed, restart the services listed by the setup wizard, including Meilisearch. If search reports an authentication error, check the key and permissions; for the bundled service, restarting Meilisearch after a secret change may resolve it. Do not remove the search data or application secrets to troubleshoot this.

For manual Compose operations:

```bash
docker compose pull && docker compose up -d
docker compose logs -f
docker compose down
```

Be careful with `docker compose down -v` because named volumes are deleted. Back up persistent data before major changes.

If `nginx-config-init` reports a missing Nginx template, run `docker compose down`, `docker compose pull`, and `docker compose up -d` to refresh the images. If you must use an older image, first update your Compose file from the [current version](docker-compose.yml), preserving any local changes. Then place the [Nginx configuration](deploy/proxy/nginx.conf) at `DATA_DIR/nginx/nginx.conf` and run `docker compose up -d` again. The initializer uses this file only when the image does not contain a template; otherwise it replaces it with the bundled version.

To add HLS image playlists to existing trickplay cache entries, preview the conversion and then write the playlists:

```bash
node scripts/convert-trickplay-cache.mjs
node scripts/convert-trickplay-cache.mjs --write
```

The script uses `DATA_DIR` from the environment or `.env` by default, preserves existing indexes and JPEG sheets, and skips existing playlists unless `--force` is supplied. Use `--data-dir /path/to/data` to select another data directory.

## 🧩 Flixer ecosystem

| Repository | Purpose |
| --- | --- |
| [Flixer](https://github.com/flixermedia/flixer) | The self-hosted backend API, authentication, libraries, and administration service. |
| [Flixer Web](https://github.com/flixermedia/flixer-web) | The Vue 3 application that powers browsing, sign-in, discovery, and playback interfaces. |
| [Flixer Streamer](https://github.com/flixermedia/flixer-streamer) | The Go service responsible for authorised media delivery and FFmpeg processing. |
| [Flixer Indexer](https://github.com/flixermedia/flixer-indexer) | The Go worker and API service for discovering, identifying, probing, and enriching media. |
| [Flixer Updater](https://github.com/flixermedia/flixer-updater) | The Go sidecar that orchestrates Docker Compose updates and restores. |
| [Flixer Plugins](https://github.com/flixermedia/flixer-plugins) | The official versioned catalogue of Flixer plugins and plugin schemas. |
| [Flixer Docs](https://github.com/flixermedia/flixer-docs) | The Docusaurus source for Flixer platform documentation. |

## 🤝 Contributing

Contributions, bug reports and documentation improvements are welcome. Open an [issue](https://github.com/flixermedia/flixer/issues) with reproduction steps or a focused proposal, then submit a pull request against the repository. Keep configuration, examples and documentation aligned with implemented code. For backend contributions, also see the [main contribution guidelines](https://github.com/flixermedia/flixer/blob/main/CONTRIBUTING.md).

Watch-party Redis scripts live in [`src/party/lua/`](src/party/lua/) and are imported as raw text into the API bundle. Their `ARGV` positions must stay aligned with the corresponding calls in [`partiesService.ts`](src/party/partiesService.ts); run `npx vitest run src/party/parties.spec.ts` after changes.

### Flixer Logger

The bundled Compose stack provisions an internal-only `flixer-logger` service.
It stores events in Pebble under `DATA_DIR/logs/logger`, creates an internal
TLS certificate on first startup, and pairs through Flixer's protected owner
bootstrap file. The certificate is mounted read-only into producer containers
for TLS verification; the Logger port is not published to the host. Producer
credentials are delivered through Flixer's signed Unix control socket rather
than the plaintext service network. Configure retention and other Logger
policies in Admin > Logging. `docker compose logs -f logger` shows Logger
diagnostics.

The Logger repository publishes its container image to
`ghcr.io/flixermedia/flixer-logger`; `LOGGER_VERSION` can pin another tag.
The updater detects the bundled Logger using `FLIXER_LOGGER_LOCAL_ENDPOINT`
(or the local owner bootstrap's loopback default), not an independently
configured external Logger. AI and Logger updates require published stable
GitHub releases and matching numeric container image tags.
When GitHub's API rate limit is reached, release checks use the public latest
release redirect; unavailable releases remain unknown rather than being inferred
from the running version.
`DATA_DIR/logs/logger` is private Logger-owned storage. Back up this directory
with `docker compose kill -s USR1 logger` and copy the resulting checkpoint
from `DATA_DIR/logs/logger/checkpoints`, or stop Logger before copying the
store. Do not copy only the active Pebble files while the service is running.

### Logger correlation integration test

The optional `src/api/ai/loggerCorrelationIntegration.spec.ts` test sends two
concurrent requests from Flixer's recommendation service to a running AI
service and checks their trace-indexed events in a real logger. Use an isolated
logger deployment and AI instance with recommendations disabled. Provision an
AI ingestion credential for that deployment and set the following environment
variables securely before running the test:

- `LOGGER_CORRELATION_URL`: logger origin.
- `LOGGER_CORRELATION_INGEST`: application-bound `flixer` ingestion credential.
- `LOGGER_CORRELATION_QUERY`: query credential for the same deployment.
- `LOGGER_CORRELATION_AI_URL`: AI service origin.
- `LOGGER_CORRELATION_AI_SECRET`: AI internal authentication secret.

Run `npx vitest run src/api/ai/loggerCorrelationIntegration.spec.ts`. The test
is skipped when these values are absent; it does not provision the services or
verify full-stack deployment.

### Logger owner integration test

The optional owner integration test starts a disposable local logger, creates
temporary credentials, and verifies owner isolation and capacity rejection
and recovery through Flixer's `LoggerService`. Build the logger first and
provide its binary path:

```sh
cd ../flixer-logger
go build -o /tmp/flixer-logger-test ./cmd/flixer-logger
cd ../flixer
FLIXER_LOGGER_TEST_BINARY=/tmp/flixer-logger-test npx vitest run src/api/logger/loggerOwnerIntegration.spec.ts
```

The test is skipped when the binary path is absent. It does not exercise the
HTTP authentication layer of Flixer, browser-to-API integration or deployment.

## 📄 Licence

Check this repository's [`LICENSE`](LICENSE) file, if present, for the authoritative licensing terms. The [main Flixer backend](https://github.com/flixermedia/flixer/blob/main/LICENSE) uses MIT; licensing for separate components should be verified individually before redistribution.

---

<div align="center">

**Your media. Your server. Your rules.**

Made for the [Flixer](https://github.com/flixermedia) ecosystem.

</div>
