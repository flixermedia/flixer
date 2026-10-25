<div align="center">

  <img src="https://raw.githubusercontent.com/flixermedia/flixer/main/resources/logo/flixer-logo.png" alt="Flixer Logo" width="150" height="150" />

## Releases

See [VERSION.md](./VERSION.md) for the versioning policy, release steps, and Docker image tags. In brief, `package.json` is the source of truth; push a matching `vX.Y.Z` tag to run the GitHub release workflow.

## Commit messages

Husky runs a `commit-msg` hook that adds a random emoji after recognized commit types such as `feat:`, `fix(scope):`, `docs:`, or `chore:`. For example, `feat: add settings API` becomes `feat: ✨ add settings API`. Existing emoji-containing messages and unrecognized message formats are left unchanged. Run `npm install` to install the Git hooks in a fresh clone.

## Updating the Insomnia API collection

**Your media, your rules, beautifully streamed.**

[![GitHub release](https://img.shields.io/github/v/release/flixermedia/flixer?style=flat-square&color=blue)](https://github.com/flixermedia/flixer/releases)
[![Docker Image CI](https://img.shields.io/github/actions/workflow/status/flixermedia/flixer/release.yml?style=flat-square&label=Docker)](https://github.com/flixermedia/flixer/pkgs/container/flixer)
[![License](https://img.shields.io/github/license/flixermedia/flixer?style=flat-square&color=green)](https://github.com/flixermedia/flixer/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/flixermedia/flixer?style=flat-square)](https://github.com/flixermedia/flixer/stargazers)

</div>

---

> **🚧 Under Active Development:** Flixer is currently in early-stage development. APIs, features, configuration options, and UI elements are subject to frequent changes. If you encounter bugs or missing features, feel free to open an issue or pull request!

> **ℹ️ Note on Architecture:** This repository contains the **backend API server** for Flixer. The user interface and web client reside in a separate repository at [flixermedia/flixer-web](https://github.com/flixermedia/flixer-web).

---

**Flixer** is a modern, blazing-fast, open-source media server that puts you in complete control of your personal entertainment library. Stream your movies, TV shows, and music anywhere, on any device, with zero friction and total privacy.

---

## 🌟 Why Flixer?

- 🚀 **High Performance:** Built from the ground up for speed, minimal resource usage, and instant playback.
- 🔒 **100% Private & Self-Hosted:** Your data stays with you. No tracking, no data collection, no forced cloud accounts.
- 🎨 **Sleek, Modern Interface:** A gorgeous, intuitive UI designed to make browsing your collection a joy.
- 📱 **Cross-Platform:** Stream seamlessly across web browsers, mobile devices, and smart TVs.
- 🛠️ **Open Source:** Community-driven and fully customizable.

---

## 📸 Screenshots

_(Coming soon as the UI evolves! Check back for updates.)_

---

## 🚀 Getting Started

The backend, Vue web app, Go streamer, and reverse proxy are run together with Docker Compose. The proxy is the only
service exposed to the host; it serves the web app and routes API, WebSocket, and media-streaming requests internally.
PostgreSQL is bundled in the Compose file, or you can use your own server; the setup wizard or `DATABASE_URL` selects it.

### Prerequisites

- Docker Engine and Docker Compose v2.
- Optionally, your own PostgreSQL 13+ database (a bundled one is included).
- A media directory readable by Docker.

### Quick Start with Docker Compose

1. Clone this repository and create a `.env` file next to `docker-compose.yml`. `DATA_PATH` is required: it is the folder
   where Flixer keeps avatars, metadata (the indexer's cache and uploaded artwork), and logs. It is created if missing.
   `MEDIA_PATH` is your media folder and defaults to `./media`. Then start the stack:

   ```bash
   printf 'DATA_PATH=/path/to/flixer-data\nMEDIA_PATH=/path/to/your/media\n' > .env
   docker compose up -d
   ```

2. Open `http://localhost:8080` (or the host port set in `HTTP_PORT`). The setup wizard opens on a fresh install.
   Choose **Quick Setup** or **Advanced Setup**. The bundled PostgreSQL and Redis are pre-filled in the wizard
   (`postgres://flixer:flixer@postgres:5432/flixer` and `redis://redis:6379`), or enter your own. The wizard also
   creates the administrator account.

Secrets are generated automatically. Settings are saved in a SQLite file on the `flixer-config` volume, with
secrets encrypted by a key file that lives next to it; keep both together when backing up. The stream secret is
shared with the streamer and indexer through the `flixer-secrets` volume.

Anything you set as an environment variable (in `.env`, copied from `.env.example`) wins over the wizard and shows
as locked there, so existing installs that already have a `.env` keep working unchanged. Services other than the
API need no database or Redis settings: the indexer fetches its Redis connection from the API. Changing the Redis
URL needs an indexer restart (`docker compose restart indexer`); a new stream secret needs the API, streamer and
indexer restarted.

If setup was completed but the server later starts with no database configured (for example a database URL that only
lived in a removed `.env`), the wizard opens in recovery mode. The API prints a one-time recovery code in its log
(`docker compose logs api`); enter it in the wizard to reconnect a database. Only the database can be changed this way,
the code changes on every start, and repeated wrong codes are locked out for ten minutes.

`MEDIA_PATH` (default `./media`) is mounted at `/media` in the API, streamer and indexer; it is read-only in the API
and streamer. Avatars live in `DATA_PATH/avatars`, metadata (indexer cache and uploaded artwork) in
`DATA_PATH/metadata`, SMB share mount points in `DATA_PATH/mounts`, and application log files in `DATA_PATH/logs`. The default Compose files work on Docker Desktop because they do not request mount propagation. Settings, secrets, PostgreSQL and Redis stay in
Docker volumes. Network shares can be added in the app instead of a local folder (see below).

Compose also runs `flixer-indexer` (with Redis), which scans libraries and stores items through the signed
`/api/indexer/*` endpoints using the same `APP_SECRET`. Admins start scans and tune workers through
`/api/admin/indexer/*`; flixer reaches the indexer at `INDEXER_URL` (default `http://localhost:8092` outside Compose).
The indexer mounts the media directory read-write so artwork can be saved alongside media.

#### SMB shares in Docker

- **Windows, macOS and Linux:** set `SMB_HOST`, `SMB_SHARE`, and usually `SMB_USERNAME` and `SMB_PASSWORD` in `.env`,
  then start the stack with `docker compose -f docker-compose.yml -f docker-compose.smb-volume.yml up -d` (or set
  `COMPOSE_FILE=docker-compose.yml:docker-compose.smb-volume.yml`, separating files with `;` on Windows). Docker mounts
  the share as a CIFS volume at `/smb` in the API, streamer, and indexer, and it is added to the media roots so you can
  create a library from it. Use the server's IP address for `SMB_HOST`, and add `SMB_OPTIONS=ro` to mount it read-only.
- **Linux only:** `docker-compose.smb.yml` lets flixer mount shares itself from **Libraries > Network shares**:
  `docker compose -f docker-compose.yml -f docker-compose.smb.yml up -d`. It grants the API container the privileges
  and mount propagation required to create CIFS mounts and share them with the streamer and indexer. Do not use this
  override on Docker Desktop for Windows or macOS; instead, mount the share on the host and expose it through `MEDIA_PATH`.

The Compose stack pulls `ghcr.io/flixermedia/flixer-web:latest` and
`ghcr.io/flixermedia/flixer-streamer:latest`, while building the backend and proxy locally. The image workflows in
the web and streamer repositories publish `main`, release-tag, and commit-SHA images to GitHub Container Registry.
The backend workflow publishes versioned images and `latest` when a matching `vX.Y.Z` release tag is pushed. If
packages are private, authenticate Docker to `ghcr.io` before starting the stack.

For development, use `docker-compose.dev.yml`, which builds the API and the sibling `../flixer-web`, `../flixer-streamer` and
`../flixer-indexer` checkouts from source instead of pulling published images. It is the same stack as
`docker-compose.yml` (including the bundled PostgreSQL and Redis), with debug logging, and it needs `DATA_PATH` too:

```bash
docker compose -f docker-compose.dev.yml up --build
```

It uses the same `.env` and port as the production stack, under its own project name (`flixer-dev`) so its volumes stay separate. The local Vite development server continues to proxy `/api`
directly to `http://localhost:8083`; the Compose stacks instead route all client traffic through the proxy on port 8080.

### Settings

Settings are stored as JSON values in the global `settings` table. Their definitions live in [src/config/settings.json](./src/config/settings.json), which declares each key, its default value, and whether it is public. On startup, the app adds missing rows with their defaults, updates visibility, preserves values already stored in the database, and deletes rows whose keys were removed from the JSON file. `updated_at` is maintained automatically. Settings have no per-user overrides.

- `GET /api/settings` requires a bearer token. All signed-in users receive global settings marked public; only admins receive private settings such as `secret_key`.
- `GET /api/settings/registration` is public and returns whether account registration is enabled.
- `PUT /api/settings/:key` requires an admin bearer token and a `{ "value": ... }` body to update a global setting.

The `registration_enabled` setting defaults to `true`. An administrator can disable public account creation with `PUT /api/settings/registration_enabled` and `{ "value": false }`; while disabled, only an authenticated administrator can create accounts through `POST /api/auth/register`. The initial account can still be created to bootstrap the first administrator.

Account registration requires a username, a valid email address, and a password.

To add, remove, or change the visibility of a setting, edit `src/config/settings.json` and restart the server; no migration is needed for changes to the settings list. The default value is only used when a row is first created—changing it later does not overwrite the live value in the database. Unset values use JSON `null`, which is stored as SQL `NULL`.

Scheduled and background jobs are managed by [pg-boss](https://github.com/timgit/pg-boss), an MIT-licensed PostgreSQL-backed job queue. It uses the existing `DATABASE_URL`; no Redis service is needed. Supabase hosts and URLs with an SSL-required mode automatically use verified TLS for both TypeORM and pg-boss connections. If Node.js does not trust the database certificate, download the database CA certificate from Supabase **Database Settings > SSL Configuration** and set `DATABASE_SSL_CA_PATH` in `.env` to its local path. Certificate verification remains enabled. pg-boss creates and manages its own `pgboss` schema, so the database role must be permitted to create that schema and its tables. It requires PostgreSQL 13+ and Node.js 22.12+. Add future job handlers and schedules in `src/jobs` and register them in `JobScheduler`.

## 🗺️ Roadmap

We are just getting started! Here is a sneak peek at what is on the horizon:

- [ ] **Core Server & Media Scanner:** Automated metadata fetching for movies and TV shows.
- [ ] **Transcoding Engine:** On-the-fly hardware-accelerated transcoding (NVENC/QuickSync).
- [ ] **Web Client & Mobile Apps:** Polished clients for Android, iOS, and desktop.
- [ ] **User Management:** Multi-user support with parental controls and watch history.
- [ ] **Plugins & Extensions:** Community-created addons and metadata providers.

Check out our [GitHub Projects board](https://github.com/flixermedia/flixer/projects) to track our progress in detail.

---

## 🤝 Contributing

We love contributions from the community! Whether it is fixing a bug, translating the interface, suggesting a feature, or writing documentation, your help is welcome.

1. Fork the [Repository](https://github.com/flixermedia/flixer)
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting PRs.

---

## 💖 Support the Project

If you love Flixer, please consider giving the repository a ⭐ **star** to help others discover it!

---

## 📄 License

Flixer is open-source software licensed under the **[MIT License](LICENSE)**.

---

<div align="center">
  <p>Built with ❤️ by the Flixer Community</p>
</div>
