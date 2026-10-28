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

## 🏗️ Architecture

Flixer separates application logic from its web UI, media indexing, media delivery, update management, plugins and documentation. **Flixer** owns the following responsibility: the self-hosted backend API, authentication, libraries, and administration service.

For the full platform, the API coordinates services; the browser interacts with the backend and the streamer receives authorised playback requests. Components should be operated as part of the supported Flixer stack unless you are developing or testing them directly.

## 🚀 Getting started

### Recommended installation
Review the installer before execution, then run:

```bash
curl -fsSL https://get.flixer.dev | bash
```

Supported install targets described by the project are macOS and Debian/Ubuntu Linux. The installer configures Docker and Compose, prompts for directories and port, and launches onboarding at `http://localhost:8080` by default.

### Manual Docker Compose

```bash
mkdir flixer && cd flixer
curl -fsSLO https://raw.githubusercontent.com/flixermedia/flixer/main/docker-compose.yml
printf 'DATA_DIR=/path/to/flixer-data\nMEDIA_PATH=/path/to/media\n' > .env
docker compose up -d
```

`DATA_DIR` maps into containers as `/data`; `MEDIA_PATH` is the host library root. Override `HTTP_PORT` when required. See [`.env.example`](.env.example) for advanced settings and [the installer source](install.sh) before running it. Use `docker compose logs -f` to troubleshoot.

## ⚙️ Configuration and operations

- `DATA_DIR` is required for persisted settings, PostgreSQL data, logs, caches, avatars and backups.
- The onboarding wizard stores settings in SQLite; explicitly supplied environment values take precedence.
- PostgreSQL provides application data; Redis supports supporting services.
- Only the reverse proxy should be published to the host by the bundled stack.
- For source-based development, clone sibling services and run `docker compose -f docker-compose.dev.yml up --build`.
- See [`FEATURES.md`](FEATURES.md), [`VERSION.md`](VERSION.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for complete feature, release and contribution details.

## 🧰 Maintenance

```bash
docker compose pull && docker compose up -d
docker compose logs -f
docker compose down
```

Be careful with `docker compose down -v` because named volumes are deleted. Back up persistent data before major changes.

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

## 📄 Licence

Check this repository's [`LICENSE`](LICENSE) file, if present, for the authoritative licensing terms. The [main Flixer backend](https://github.com/flixermedia/flixer/blob/main/LICENSE) uses MIT; licensing for separate components should be verified individually before redistribution.

---

<div align="center">

**Your media. Your server. Your rules.**

Made for the [Flixer](https://github.com/flixermedia) ecosystem.

</div>
