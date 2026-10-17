<div align="center">

  <img src="https://raw.githubusercontent.com/flixermedia/flixer/main/resources/logo/flixer-logo.png" alt="Flixer Logo" width="150" height="150" />

## Releases

See [VERSION.md](./VERSION.md) for the versioning policy, release steps, and Docker image tags. In brief, `package.json` is the source of truth; push a matching `vX.Y.Z` tag to run the GitHub release workflow.

## Updating the Insomnia API collection

**Your media, your rules, beautifully streamed.**

[![GitHub release](https://img.shields.io/github/v/release/flixermedia/flixer?style=flat-square&color=blue)](https://github.com/flixermedia/flixer/releases)
[![Docker Image CI](https://img.shields.io/github/actions/workflow/status/flixermedia/flixer/docker.yml?style=flat-square&label=Docker)](https://github.com/flixermedia/flixer/pkgs/container/flixer)
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

Getting Flixer up and running on your server is quick and easy using Docker.

### Prerequisites

- Docker and Docker Compose installed on your system.

### Quick Start with Docker Compose

1. Create a `docker-compose.yml` file:

```yaml
version: "3.8"

services:
    flixer:
        image: ghcr.io/flixermedia/flixer:latest
        container_name: flixer
        restart: unless-stopped
        ports:
            - "8080:8080"
        volumes:
            - ./config:/config
            - /path/to/your/media:/media
        environment:
            - PUID=1000
            - PGID=1000
```

2. Start the container:

```bash
docker compose up -d
```

3. Open your browser and navigate to **`http://localhost:8080`** to finish the setup wizard!

### Settings

Settings are stored as JSON values in the global `settings` table. Their definitions live in [src/config/settings.json](./src/config/settings.json), which declares each key, its default value, and whether it is public. On startup, the app adds missing rows with their defaults, updates visibility, preserves values already stored in the database, and deletes rows whose keys were removed from the JSON file. `updated_at` is maintained automatically. Settings have no per-user overrides.

- `GET /api/settings` requires a bearer token. All signed-in users receive global settings marked public; only admins receive private settings such as `secret_key`.
- `PUT /api/settings/:key` requires an admin bearer token and a `{ "value": ... }` body to update a global setting.

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
