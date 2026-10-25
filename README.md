<div align="center">

  <img src="https://raw.githubusercontent.com/flixermedia/flixer/main/resources/logo/flixer-logo.png" alt="Flixer Logo" width="150" height="150" />

# Flixer

**Your media, your rules, beautifully streamed.**

[![GitHub release](https://img.shields.io/github/v/release/flixermedia/flixer?style=flat-square&color=blue)](https://github.com/flixermedia/flixer/releases)
[![Docker Image CI](https://img.shields.io/github/actions/workflow/status/flixermedia/flixer/release.yml?style=flat-square&label=Docker)](https://github.com/flixermedia/flixer/pkgs/container/flixer)
[![License](https://img.shields.io/github/license/flixermedia/flixer?style=flat-square&color=green)](https://github.com/flixermedia/flixer/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/flixermedia/flixer?style=flat-square)](https://github.com/flixermedia/flixer/stargazers)

</div>

---

> **🚧 Under Active Development:** Flixer is in early-stage development. APIs, features and configuration options change frequently. If you hit a bug or a missing feature, please open an issue or pull request.

> **ℹ️ Architecture:** This repository is the **backend API server**. The web client lives in [flixer-web](https://github.com/flixermedia/flixer-web), with [flixer-streamer](https://github.com/flixermedia/flixer-streamer) (Go, streaming and transcoding) and [flixer-indexer](https://github.com/flixermedia/flixer-indexer) (Go, library scanning). See [FEATURES.md](./FEATURES.md) for everything Flixer can do.

**Flixer** is a modern, open-source, self-hosted media server. Stream your movies and TV shows anywhere, on any device, with total privacy.

- 🚀 **Fast:** minimal resource usage and instant playback.
- 🔒 **Private:** no tracking, no data collection, no forced cloud accounts.
- 🎨 **Modern UI:** chapters, intro skipping, picture-in-picture and a corner mini player.
- 🛠️ **Open source:** community-driven and fully customizable.

---

## 🚀 Install

Works on **macOS** and **Debian/Ubuntu Linux**. One command installs Docker if you want it, writes the configuration, optionally connects an SMB share, and starts Flixer:

```bash
curl -fsSL https://get.flixer.dev | bash
```

The installer asks for an install folder (default `~/flixer`), a data folder, a media folder and an HTTP port, then downloads `docker-compose.yml`, creates `.env` and runs `docker compose up -d`. When it finishes, open <http://localhost:8080> and the setup wizard creates your administrator account.

Options can be passed after `bash -s --` for unattended installs:

```bash
curl -fsSL https://get.flixer.dev | bash -s -- --yes --media /mnt/media --port 8080
```

| Option                                                           | Description                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--dir <path>`                                                   | Install directory (default `~/flixer`)                              |
| `--data <path>` / `--media <path>`                               | Data folder (default `<dir>/data`) and media folder (`<dir>/media`) |
| `--port <port>`                                                  | HTTP port (default `8080`)                                          |
| `--version <tag>`                                                | Pin the Flixer image version (default `latest`)                     |
| `--smb`, `--smb-host`, `--smb-share`, `--smb-user`, `--smb-pass` | Connect an SMB share (see below)                                    |
| `--install-docker`                                               | Install Docker if missing without asking                            |
| `--yes`                                                          | Accept defaults and never prompt                                    |
| `--dry-run`                                                      | Print what would happen without changing anything                   |
| `--no-start`                                                     | Write the files but do not start Flixer                             |

You can review the script first at [install.sh](./install.sh). On macOS, Docker is installed as Docker Desktop through Homebrew. On Debian/Ubuntu, Docker Engine is installed with Docker's official script and your user is added to the `docker` group.

### Network (SMB) shares

Answer yes to the SMB prompt (or pass `--smb-host 192.168.1.10 --smb-share media --smb-user me --smb-pass secret`). The installer adds `docker-compose.smb-volume.yml`, and Docker mounts the share as a CIFS volume at `/smb` in the API, streamer and indexer. It then appears as a media root when you create a library. Use the server's IP address, not its hostname, and note that passwords containing a comma are not supported. Add `SMB_OPTIONS=ro` to `.env` for a read-only mount.

On Linux, `docker-compose.smb.yml` is an alternative that lets Flixer mount shares itself from **Libraries > Network shares**. It needs a Linux host and extra container privileges, so do not use it with Docker Desktop.

### Manual install

Requires Docker Engine and Docker Compose v2.

```bash
mkdir flixer && cd flixer
curl -fsSLO https://raw.githubusercontent.com/flixermedia/flixer/main/docker-compose.yml
printf 'DATA_PATH=/path/to/flixer-data\nMEDIA_PATH=/path/to/your/media\n' > .env
docker compose up -d
```

`DATA_PATH` is required and holds avatars, metadata, logs, SMB mount points, backups and the bundled PostgreSQL data (`postgres/`). `MEDIA_PATH` defaults to `./media`, and is mounted at `/media` (read-only in the API and streamer). `HTTP_PORT` defaults to `8080`. Optional `FLIXER_VERSION`, `STREAMER_VERSION`, `INDEXER_VERSION` and `WEB_VERSION` pin image versions. See [.env.example](./.env.example) for everything else.

### Update, stop and uninstall

```bash
cd ~/flixer
docker compose pull && docker compose up -d   # update
docker compose logs -f                        # logs
docker compose down                           # stop (keeps your data)
docker compose down -v                        # stop and delete Redis/config volumes (PostgreSQL lives in DATA_PATH/postgres)
```

### Configuration notes

- Secrets are generated automatically. Settings are saved in a SQLite file on the `flixer-config` volume, with secrets encrypted by a key file next to it; keep both together when backing up. The stream secret is shared with the streamer and indexer through the `flixer-secrets` volume.
- Environment variables in `.env` win over the setup wizard and show as locked there.
- The bundled PostgreSQL and Redis are pre-filled in the wizard (`postgres:5432/flixer` and `redis://redis:6379`), or you can use your own.
- **Recovery mode:** if setup was completed but no database is configured on start, the wizard opens in recovery mode. The API prints a one-time recovery code in its log (`docker compose logs api`); enter it to reconnect a database. The code changes on every start and repeated wrong codes are locked out for ten minutes.
- Only the `proxy` service is exposed to the host; it serves the web app and routes API, WebSocket and media-streaming requests internally.
- The indexer mounts the media folder read-write so artwork can be saved next to media.
- If the images are private, authenticate Docker to `ghcr.io` first.

### Development

`docker-compose.dev.yml` builds the API and the sibling `../flixer-web`, `../flixer-streamer` and `../flixer-indexer` checkouts from source, with debug logging. It needs `DATA_PATH` too and uses its own project name (`flixer-dev`) so volumes stay separate:

```bash
docker compose -f docker-compose.dev.yml up --build
```

The local Vite dev server proxies `/api` to `http://localhost:8083`; the Compose stacks route everything through the proxy on port 8080.

---

## ⚙️ Settings

Settings are stored as JSON values in the global `settings` table. Their definitions live in [src/config/settings.json](./src/config/settings.json), which declares each key, its default value and whether it is public. On startup the app adds missing rows with their defaults, updates visibility, preserves stored values and deletes rows whose keys were removed from the file. Settings have no per-user overrides, and no migration is needed to add, remove or change them. A default is only used when a row is first created.

- `GET /api/settings` requires a bearer token. Signed-in users receive public settings; admins also receive private ones.
- `GET /api/settings/registration` is public and returns whether registration is enabled.
- `PUT /api/settings/:key` requires an admin token and a `{ "value": ... }` body.

`registration_enabled` defaults to `true`. When disabled, only an authenticated administrator can create accounts, though the first administrator can always be created. `skipme_api_url` (admin dashboard, Providers) sets the SkipMe.db endpoint used for intro and segment lookups; leave it empty to turn lookups off.

Background jobs use [pg-boss](https://github.com/timgit/pg-boss) on the existing `DATABASE_URL`. Supabase hosts and SSL-required URLs use verified TLS; if Node.js does not trust the certificate, set `DATABASE_SSL_CA_PATH` in `.env` to the CA file. PostgreSQL 13+ and Node.js 22.12+ are required.

---

## 🧾 Releases

See [VERSION.md](./VERSION.md) for the versioning policy and image tags. `package.json` is the source of truth; push a matching `vX.Y.Z` tag to run the release workflow. Changes to `install.sh` on `main` are published to `get.flixer.dev` automatically.

## 💬 Commit messages

Husky runs a `commit-msg` hook that adds an emoji after recognized types such as `feat:`, `fix(scope):` or `docs:`; for example `feat: add settings API` becomes `feat: ✨ add settings API`. Run `npm install` to install the hooks in a fresh clone.

---

## 🤝 Contributing

Contributions are welcome: bug fixes, translations, features and docs.

1. Fork the [repository](https://github.com/flixermedia/flixer)
2. Create a branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes
4. Push the branch and open a Pull Request

Please read the [Contributing Guidelines](CONTRIBUTING.md) first.

## 📄 License

Flixer is open-source software licensed under the **[MIT License](LICENSE)**.

<div align="center">
  <p>Built with ❤️ by the Flixer Community</p>
</div>
