# Versioning and releases

This project uses Semantic Versioning (`MAJOR.MINOR.PATCH`). The version in
`package.json` is the source of truth, and release Git tags use the `v` prefix.
For example, package version `1.2.3` is released as Git tag `v1.2.3`.

## Choosing the version bump

- **Patch** (`1.2.3` → `1.2.4`): backward-compatible bug fixes and small
  corrections.
- **Minor** (`1.2.3` → `1.3.0`): backward-compatible features or API additions.
- **Major** (`1.2.3` → `2.0.0`): breaking API, behavior, or configuration
  changes.

Before the first stable release, a `0.x.y` version may be used while the API is
still changing. This repository currently starts at `1.0.0`.

## Preparing a release

Releases are tagged automatically. When a push to `main` contains a `package.json` version that has no `vX.Y.Z` tag
yet, the release workflow publishes the Docker image, creates the tag, and creates the GitHub Release. If the tag
already exists, the push is skipped. To release, bump the version and push to `main`:

```powershell
npm version patch --no-git-tag-version
```

Replace `patch` with `minor` or `major` when appropriate, commit `package.json` and `package-lock.json`, and push.
Pushing a matching `vX.Y.Z` tag manually still works; the workflow rejects a tag that differs from `package.json`.

The manual steps below remain valid if you prefer to create the tag yourself.

### Manual tagging

1. Merge the changes intended for release into `main`. Make sure the working
   tree is clean and the changes are committed.
2. From `main`, choose the appropriate version bump:

   ```powershell
   npm version patch
   ```

   Replace `patch` with `minor` or `major` when appropriate. `npm version`
   updates both `package.json` and `package-lock.json`, creates a version commit,
   and creates the matching annotated Git tag. Do not update the version in only
   one of those files or create a tag with a different version.
3. Push the version commit and tag:

   ```powershell
   git push origin main --follow-tags
   ```

The GitHub Actions workflow in
[`.github/workflows/release.yml`](./.github/workflows/release.yml) runs when a
`v*` tag is pushed. It accepts only stable `vX.Y.Z` tags and checks that the tag
version exactly matches `package.json`. A mismatch or a tag with a different
format fails the release job.

## What the release publishes

After validation, GitHub Actions builds the Docker image and publishes it to
GitHub Container Registry (GHCR):

- `ghcr.io/flixermedia/flixer:X.Y.Z` — immutable version-specific release tag.
- `ghcr.io/flixermedia/flixer:latest` — points to the most recently published
  release.

The image also includes the version in its
`org.opencontainers.image.version` label. The workflow then creates a GitHub
Release for the same tag and generates release notes from the repository
history. It uses the workflow's `GITHUB_TOKEN`; repository Actions settings
must allow workflows to write packages and releases.

For example, release `v1.2.3` can be pulled with:

```powershell
docker pull ghcr.io/flixermedia/flixer:1.2.3
```

Use the version-specific image tag when pinning deployments. Avoid reusing or
moving an existing release tag; publish a new version for each release.
