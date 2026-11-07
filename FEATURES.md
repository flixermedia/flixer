# Flixer features

A complete list of what the Flixer platform does, grouped by the repository that provides it.

| Repository                                                        | Role                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [flixer](.)                                                       | Ts.ED/Fastify API: accounts, libraries, catalogue, playback authorisation, payments, admin, updates and backups |
| [flixer-web](https://github.com/flixermedia/flixer-web)           | Vue 3 single-page app: browsing, video and music players, settings and the admin dashboard            |
| [flixer-streamer](https://github.com/flixermedia/flixer-streamer) | Go media-delivery service: direct play, remux, transcoding, HLS, subtitles, trickplay                 |
| [flixer-indexer](https://github.com/flixermedia/flixer-indexer)   | Go scanner and metadata pipeline: scanning, identification, artwork, probing, subtitles               |

Flixer also relies on `flixer-updater` for the update and restore flow.

Movie and series pages preview TMDB-listed YouTube trailers through the streamer. Administrators can enable on-demand trailer caching in the dashboard, provided they have permission to store and serve them. The first viewer streams the remote trailer while Flixer downloads a copy in the background; later viewers stream the cached copy from `DATA_DIR/cache/trailers`. Caching is off by default. Trailer resolution and downloads require `yt-dlp`, its `yt-dlp-ejs` challenge solver and Node.js; downloads also require `ffmpeg` (all included in the API Docker image). Trailers are limited to 20 minutes and cached files to 250 MiB. Remote playback requires a combined H.264/AAC MP4 format; availability depends on YouTube, the uploader and region. Standalone installations must make the same cache directory visible to both the API and streamer at the same path.

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
- Chapter titles consisting only of timestamps are replaced with their chronological chapter number; descriptive titles are retained. The change applies to indexed and manually edited chapters without modifying media files.
- Segment sources by priority: manual, timings synced from TheIntroDB with IntroDB as a fallback for missing timings or request failures, optional plugin segments, then chapter titles.
- Admin tools to set or clear a manual segment on an item.
- Active stream sessions listing for admins.

### Personal playback webhooks

- Disabled by default. Under Admin → Settings → Webhooks, administrators enable the feature, choose administrators only or all users, and configure allowed destination rules. By default, `regex:https?://.*` allows any HTTP(S) URL, including local-network and internal addresses. When enabled for all users this permits users to send requests from the server's network; restrict the rules to trusted destinations if users are not fully trusted. Redirects and URLs containing embedded credentials are rejected. HTTPS is recommended.
- Rules are exact URLs or RE2 regular expressions prefixed with `regex:`, one per line. Expressions match the entire normalized URL and do not support lookarounds or backreferences. For example, `regex:https://automation\.example\.com/.*` allows paths on that host. An empty list denies all destinations. Existing nonempty exact-URL lists are retained on upgrade; an empty legacy list is changed to the default rule.
- Eligible users manage up to 10 of their own webhooks under Settings → Webhooks. Only the authenticated user's events are delivered to their enabled destinations, and changing destination rules or disabling the feature stops future delivery to destinations no longer permitted. URLs, including any query tokens, are stored in the database; administrators can see the allowlist. Treat them as secrets.
- Flixer's web and native video players, live TV player and music player emit `playback.started`, `playback.paused`, `playback.resumed` and `playback.stopped`. Every delivery is a JSON POST containing `id`, `event`, `occurredAt` (UTC), `userId`, `media` (`kind`, `id`, `title`, and for library media `type`), and `positionSeconds`. For example:

  ```json
  {"id":"a89c26d2-513c-4528-9d8b-7ca16004bf72","event":"playback.started","occurredAt":"2026-01-01T12:00:00.000Z","userId":"d3929747-385b-4245-a8d2-682c37626192","media":{"kind":"video","id":"b89c26d2-513c-4528-9d8b-7ca16004bf72","title":"Movie","type":"movie"},"positionSeconds":0}
  ```

- Playback reports are client-generated and best effort: interruptions, other clients, player reloads and ad breaks can omit or split transitions. Deliveries are ordered per webhook within one API process, bounded, time out after five seconds, and are not retried or persisted. Failures are logged without logging destination URLs. They are not signed, so secure receiving endpoints with an unguessable URL and network controls.

### Video advertisements

- Disabled by default; administrators manage advertisements under Admin → Advertising → Advertisements.
- Upload MP4 videos (H.264 video, AAC audio when present), up to 100 MiB, in retryable chunks. Uploads are staged for up to 24 hours; expired sessions are removed when another upload is started. The API requires `ffprobe`.
- Uploaded videos are stored in `DATA_DIR/advertisements`. The API needs write access, and Flixer Streamer needs read access to the same directory at the same path. Back up this directory separately: the built-in system backup currently does not include it.
- Enable individual ads and target all content, a content kind, or specific items using the scope picker. Configure pre-roll and mid-roll positions in seconds, a minimum interval between breaks, and a maximum number of breaks per playback. These limits apply per playback, not across sessions; positions before a resume point are not replayed.
- Ads link to an HTTP(S) destination and can be unskippable or skippable after a configured viewing time. Ads use the web player in native apps when scheduled.
- Payment products can exempt the covered purchased or rented content, and subscription plans can exempt subscribers server-wide while their subscription grants access. The exemption follows the current product or plan configuration.

### Analytics

- Admin → Analytics provides video rankings based on latest per-user watch progress, cumulative music plays, searchable watch progress, client-reported ad views and watch time, and order and subscription snapshots. Payment values are grouped by currency and current status, not presented as revenue.
- Client-reported video and live TV sessions record measured playback time from this version onwards. Pauses, seeks, advertising breaks and stalled playback are excluded; interrupted or offline reports may be incomplete. Sessions may split during ads or player changes. Analytics → Watch History shows up to 50 recent sessions as well as separately searchable latest saved progress. Session records are associated with signed-in users, deleted when the user or media item is deleted, and removed after 90 UTC calendar days by the daily analytics-retention job.
- Music analytics records new song starts from this version, separately from the pre-existing cumulative play counts. Music events are deleted with their user or track and retained for 90 UTC calendar days. Payment order trends group orders by UTC creation day, kind, currency and current status; current values and refunds are not cash-flow or revenue figures.
- Ad viewing data is associated with the signed-in user and removed when that user or advertisement is deleted. Collection begins with this version, may be incomplete, and is not suitable for billing. Ad records currently have no automatic retention limit. Latest watch progress is not a full play history or total watch time.
- Advertising analytics supports the last 7, 30 or 90 UTC calendar days, including today. Views, current outcomes and reported watch time are attributed to the day each view began. The optional dashboard widget displays all-time ad totals.
- Optional dashboard widgets show advertising totals and seven-day video and live viewing sessions.
- Daily analytics charts visualize viewing sessions, advertisement views, song starts and order counts; detailed tables remain available for exact values.

### Subtitles

- Per-item subtitle listing, search (OpenSubtitles) and download, and deletion.
- Subtitle credentials and language preferences managed in the admin dashboard, with optional automatic fetching.
- Falls back to a data folder when the media share is read-only.

### Indexer control

- Providers: enable or disable each metadata provider, including default-on TheIntroDB and IntroDB fallback timing lookups (TheIntroDB works without an API key; an optional key can be configured), and store provider credentials (keys are masked on read).
- Metadata language and per-queue worker concurrency.
- Queue controls: pause, resume, clear failed, cancel all pending and running tasks, per queue or across all queues.
- Task list with cancel and retry, and scan history.
- Proxy for the indexer's image, person and subtitle endpoints.

### Notifications

- In-app notification feed with read state.
- Web Push: VAPID key, subscription and unsubscription, and a status endpoint.
- Admin settings for enabling notifications and new-media notifications.

### Social profiles

- Friend requests, acceptance, cancellation and removal between users on the same server.
- Profile visibility can be public, friends-only or hidden; directory, profile and playlist access follow that setting.
- Profile sharing creates configurable friend-invite links (one-time by default, unlimited or expiring by choice) that expose only a limited identity preview; accepting the invite immediately creates the friendship, including for restricted profiles.
- Watch and listen parties have separate public, friends-only or private invite-link visibility; friends-only access is enforced by the API.
- Optional end-to-end encrypted party voice chat (same `calls_enabled` switch): a peer-to-peer mesh of up to 6 people where every pair has its own ephemeral MLS group, so the server only relays encrypted signalling over the party socket (`call-signal`) and serves party-scoped key packages and ICE settings (`/parties/:id/calls/*`, members only).
- Optional end-to-end encrypted audio/video calls in direct chats (off by default, `calls_enabled`): media is peer-to-peer WebRTC and the server only relays MLS-encrypted signalling over the chat socket and hands out STUN/TURN settings (`GET /chat/calls/ice`, short-lived TURN credentials, or a static TURN username + credential for hosted services such as ExpressTURN; everything is configured in the admin dashboard).

### Requests

- Optional Jellyseerr-style request system, off by default and configured entirely from the admin dashboard.
- Search and discovery of titles missing from the library via TMDB (movies, shows) and Discogs (albums), using the keys set under Providers.
- Approved requests are sent to Sonarr, Radarr or Lidarr (multiple servers, default server, quality profile, root folder, season selection).
- Approval queue (approve, decline with reason, retry, cancel), auto-approve, per-user permissions and quotas, notifications, and automatic "available" status once the title reaches the library.

### Payments

- Optional payments are off by default and use one active provider at a time: Stripe or Square.
- Admins configure provider credentials, currency, tax rates, registration charges, and a 0–30 day subscription grace period (3 days by default). Admin accounts are exempt from paywalls.
- Paywall scopes can cover all content, a media kind (movies, TV, music or guide), an item and its descendants, or an artist. Content outside active products, plans, or registration unlock scopes remains free.
- Sell one-time purchases or rentals; rentals can begin at purchase or first play. Monthly and yearly subscriptions unlock their configured scopes, with optional free trials and recurring charges handled by Flixer.
- Registration can require a one-time fee or a subscription and can unlock all content, selected scopes, or nothing beyond account creation. A card is required for new signups whenever payments are enabled: signup is two slides, the account is created first and stays pending payment (surviving reloads and other devices, with unlimited card retries) until the card is saved.
- Existing accounts are grandfathered by default when payments are first enabled; admins can turn that off.
- Coupons support percentage or fixed-amount discounts, redemption limits, expiry and product/plan restrictions. Tax can be configured as inclusive or exclusive.
- Admins can view orders and subscriptions, issue full or partial refunds, and grant or revoke complimentary access, optionally for a limited number of hours.
- Provider webhooks must carry a valid signature (Stripe signing secret, Square signature key and notification URL) and are reconciled against the provider API before Flixer updates payment state.
- Admins choose the sold currencies from a curated, provider-aware list, and users can open provider receipts from their order history.

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
- People directory and profiles with friend requests, friend management and profile sharing.
- Watch and listen party creation with public, friends-only or private invite-link visibility.
- Join voice chat from a watch or listen party, with mute and leave controls.
- Audio and video calls from direct chats with accept/decline, mute and camera controls; admins configure STUN/TURN servers and an optional relay-only mode.
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
- Profile visibility controls and incoming, outgoing and accepted friend lists.
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
- Indexer: metadata providers, default-on TheIntroDB timings with IntroDB fallback, language, subtitle credentials, queues and workers with cancel buttons, tasks with cancel and retry.
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
