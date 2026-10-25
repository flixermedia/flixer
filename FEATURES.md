# Flixer features

A complete list of what the Flixer platform does, grouped by the repository that provides it.

| Repository                                                        | Role                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [flixer](.)                                                       | Ts.ED/Fastify API: accounts, libraries, catalogue, playback authorisation, admin, updates and backups |
| [flixer-web](https://github.com/flixermedia/flixer-web)           | Vue 3 single-page app: browsing, video and music players, settings and the admin dashboard            |
| [flixer-streamer](https://github.com/flixermedia/flixer-streamer) | Go media-delivery service: direct play, remux, transcoding, HLS, subtitles, trickplay                 |
| [flixer-indexer](https://github.com/flixermedia/flixer-indexer)   | Go scanner and metadata pipeline: scanning, identification, artwork, probing, subtitles               |

Flixer also relies on `flixer-updater` for the update and restore flow.

---

## flixer (API)

### Accounts and authentication

- Registration with an admin-controlled on/off switch, plus optional e-mail verification (verification links, resend).
- Password login with sessions that can be listed and revoked per device.
- Passkey (WebAuthn) sign-in, registration and removal, with a per-account "passkey required" option and passkey second factor.
- Password change, account recovery request, profile editing, avatar upload and removal, and self-service account deletion.
- Per-user preferences stored on the server (for example language and theme).
- Personal API keys that can be created and revoked.
- Signed-in device list with user-agent parsing.

### Administration of users

- Create, edit, reset the password of, and delete users; assign roles (admin or regular).
- Revoke all sessions of a user.
- Upload and remove avatars for other users.

### Libraries and media roots

- Movie, TV show, music and mixed libraries, each made of one or more folders.
- Media roots with identifiers so clients never send raw file paths.
- Network shares (SMB) that can be added, reconnected and removed, with credentials stored encrypted.
- Library scan, forced rescan, trickplay-only scan and prune of items whose files are gone.
- Removing a library also cancels that library's pending and running indexer tasks.
- Folder browser for picking media folders.

### Catalogue

- Home feed: featured titles, recently added movies, shows and albums, and library shortcuts.
- Browse by kind (movies, TV, music) with pagination and sorting by date added, title or year.
- Search across titles, with a genre filter; a TV series appears once rather than once per episode.
- Item detail: seasons, episodes, cast and crew, studios, ratings, genres, artwork, technical details (codecs, resolution, HDR) and chapters.
- Person pages with biography and image.
- Watched state and watch progress per item, with resume positions and a continue-watching history.
- Admin media editor: edit metadata, upload or remove artwork, lock edited fields against later overwrites, and remove items.
- Rescan a single item, or a whole series, season or album, on demand.

### Playback

- Signed playback sessions: short-lived HS256 tokens and AES-256-GCM-encrypted media locators.
- Playback info for indexed items and for built-in sample videos.
- Direct-play decision based on the container and file type.
- Next-episode lookup across seasons, ending after the last episode of the last season.
- Chapters and skippable segments (intro, recap, credits, preview, break) returned with each item.
- Segment sources by priority: manual, SkipMe.db, then chapter titles. The SkipMe.db URL is an admin setting.
- Admin tools to set or clear a manual segment on an item.
- Active stream sessions listing for admins.

### Subtitles

- Per-item subtitle listing, search (OpenSubtitles) and download, and deletion.
- Subtitle credentials and language preferences managed in the admin dashboard, with optional automatic fetching.
- Falls back to a data folder when the media share is read-only.

### Indexer control

- Providers: enable or disable each metadata provider and store its API key (keys are masked on read).
- Metadata language and per-queue worker concurrency.
- Queue controls: pause, resume, clear failed, cancel all pending and running tasks, per queue or across all queues.
- Task list with cancel and retry, and scan history.
- Proxy for the indexer's image, person and subtitle endpoints.

### Notifications

- In-app notification feed with read state.
- Web Push: VAPID key, subscription and unsubscription, and a status endpoint.
- Admin settings for enabling notifications and new-media notifications.

### Requests

- Optional Jellyseerr-style request system, off by default and configured entirely from the admin dashboard.
- Search and discovery of titles missing from the library via TMDB (movies, shows) and Discogs (albums), using the keys set under Providers.
- Approved requests are sent to Sonarr, Radarr or Lidarr (multiple servers, default server, quality profile, root folder, season selection).
- Approval queue (approve, decline with reason, retry, cancel), auto-approve, per-user permissions and quotas, notifications, and automatic "available" status once the title reaches the library.

### Operations

- Backups: create, list, download (via short-lived links), restore and delete, with optional passphrase encryption.
- Updates: check for new versions, optional auto-update, and a restore through `flixer-updater`.
- Admin overview and activity feed.
- Background jobs: enqueue, retry, delete and schedule jobs per queue.
- Live push channel that keeps the dashboard up to date.
- First-run setup wizard (database, Redis, secrets, URLs, connectivity tests) with an internal config endpoint for the other services.
- E-mail (SMTP) settings with a test message.
- Transcoding settings shared with the streamer.
- Settings stored in the database, with defaults declared in `src/config/settings.json`.
- Sentry error monitoring and version reporting.
- OpenAPI documentation.

---

## flixer-web

### Pages

- Setup wizard, login, registration, e-mail verification, and a server-unavailable screen.
- Home with a hero carousel and horizontally scrolling rows (recently added movies, shows, albums).
- Movies, TV and Music browse pages with infinite scroll in place of a "Load more" button.
- Search with type and genre filters, also with infinite scroll.
- Item pages for movies, series, seasons, episodes, albums and tracks.
- Person pages.
- Settings, and an admin dashboard with an activity page.
- Mobile tab bar and an offline banner.

### Video player

- Direct play, remux and transcode, with the playback method shown in the player.
- Custom controls: play and pause, seek bar with buffered range, volume, fullscreen and keyboard shortcuts.
- Hover seek previews from trickplay thumbnails.
- Quality selection, limited to the heights the source supports.
- Subtitles: embedded and external tracks, a subtitle picker and a fallback download.
- Picture-in-picture and a corner mini player that survives page changes. The back button or `Esc` moves the player to the corner, with an animation.
- Resume from the saved position, and progress reporting.
- Chapter markers on the seek bar and the chapter title in the hover tooltip.
- Skip Intro, Recap, Credits, Preview and Break buttons, with an optional auto-skip (never for credits).
- Next-episode countdown button that starts the next episode automatically or immediately on click, including across seasons.
- A Chapters row on item pages; each card shows an image from that point and starts playback there.

### Music player

- Persistent audio player with a queue, previous and next, seek, shuffle and repeat.
- Synchronised lyrics view.
- Album and track pages that play whole albums.

### Account settings

- Profile, avatar, password and language.
- Passkeys: add, list, remove and mark as required.
- Dark, light and automatic themes.
- Server information.
- Notification permission handling and in-app notification bell.
- Account deletion.

### Admin dashboard

- Overview, activity and logs, with live log streaming.
- General settings: server name, login banner, registration, e-mail verification and server address.
- Users: create, edit, delete and revoke sessions.
- Devices and active stream sessions.
- Libraries and network shares.
- Media: browse, edit, add artwork, rescan an item or series, subtitle search and download, and remove.
- Indexer: providers and API keys, language, SkipMe.db URL, subtitle credentials, queues and workers with cancel buttons, tasks with cancel and retry.
- Scheduled tasks.
- Transcoding: hardware acceleration, presets and concurrency.
- Networking, e-mail, notifications, error monitoring, backups and updates.
- Confirmation modals for destructive actions.

### Platform

- Translations: English, German and Spanish, with a translation check in CI.
- Realtime updates from the server.
- Authenticated image loading with a request queue.
- Docker image for linux/amd64 and linux/arm64.

---

## flixer-streamer

### Delivery

- Streams files from several configured media roots without trusting client-supplied paths.
- HTTP range requests with `206 Partial Content`.
- Direct Play, Direct Stream (remux to fragmented MP4 or WebM) and Transcode (H.264 and AAC), chosen automatically.
- Seeking in processed streams via a `start` parameter.
- HLS output.
- Cancels FFmpeg when the client disconnects.

### Security

- Short-lived HS256 JWT validation and AES-256-GCM decryption of media locators.
- Path resolution confined to allowed roots.
- Admin endpoints protected by a separate token.
- CORS handling.

### Transcoding

- Hardware encoders: NVENC, QSV, VAAPI and AMF, plus software x264, with presets.
- Settings pulled from Flixer, so they can be changed without a restart.
- Concurrency limit and session tracking.
- Stream probing, available at `/info/`.

### Subtitles, lyrics and thumbnails

- WebVTT conversion of embedded and external subtitles.
- Subtitle storage in a fallback data folder when the share is read-only.
- Lyrics for audio files.
- Trickplay: preview thumbnail sheets and a manifest for seek previews.

### Operations

- `/healthz` with the running version and the active transcode count.
- Unified and per-file logs.
- Sentry monitoring.
- Docker image (multi-arch), unprivileged user and health check.

---

## flixer-indexer

### Scanning

- Walks libraries and recognises movies, TV shows (series, seasons, episodes), music (artists, albums, tracks) and mixed libraries.
- Filename parsing for titles, years, season and episode numbers, and multi-episode files.
- File watcher that detects changes and queues work.
- Incremental scans, forced rescans and pruning of removed files.
- Rescan of a single item, or a series, season or album with everything beneath it.

### Pipeline

- Task queues: scan, identify, metadata, images, probe, refresh and trickplay.
- Per-queue concurrency, pause and resume, clear failed, retry and cancel.
- Cancel all pending and running tasks for a queue, or for one library.
- Progress reporting back to Flixer.

### Identification and metadata

- Providers: TMDB, TVDB, OMDb, Fanart.tv, TheAudioDB, Discogs, MusicBrainz, AniDB and AniList.
- Each provider can be enabled or disabled and given an API key from the dashboard.
- Metadata language setting.
- Reads local `.nfo` files and local artwork.
- Cast, crew, ratings, genres, studios, artwork and artist biographies.
- Person images and biographies.
- Lyrics lookup.

### Technical analysis

- ffprobe analysis: container, codecs, resolution, HDR, duration and chapters.
- Trickplay generation: thumbnail sheets used for seek previews.

### Subtitles

- OpenSubtitles search and download by item ids or file hash.
- Optional automatic fetching in chosen languages.
- Saves next to the video, or in a data folder when the share is read-only.
- Listing and deleting subtitles.

### Theme songs (Themerr)

- Off by default; an admin turns it on with `themes_enabled`.
- Looks up movies and shows by TMDB id in ThemerrDB (the LizardByte Themerr database) and extracts the theme audio to `theme.mp3` with yt-dlp and ffmpeg.
- yt-dlp is found on `PATH` or `YTDLP_PATH`, otherwise the standalone release is downloaded into the cache folder and refreshed every 14 days, so dev and Docker need no setup.
- Stored per media item in `DATA_PATH/cache/theme/{media-id}`, or next to the media when alongside artwork storage is enabled (cache is used when no media folder is available or the share is read-only). The media ID is a stable hash of the library root ID and relative path.
- Downloaded after indexing on a dedicated `themes` queue, and on demand for the existing library from the admin dashboard.
- The web app plays the theme quietly on movie and show pages, with a mute toggle that is remembered.
- Titles ThemerrDB has no theme for are not asked again for 30 days.

### Operations

- HMAC-signed internal API shared with Flixer.
- Runtime settings reload without a restart.
- `/health` with the running version.
- Sentry monitoring.
- Docker image (multi-arch).
