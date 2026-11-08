ARG NODE_VERSION=26.12.0
ARG GO_VERSION=1.26.0

# Toolchains and the PostgreSQL apt key are fetched in separate stages so BuildKit downloads them in parallel with the apt install.
FROM alpine:3.20 AS node
ARG NODE_VERSION
ARG TARGETARCH
RUN apk add --no-cache curl xz \
    && node_arch="$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64)" \
    && mkdir /out \
    && curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 600 "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" | tar -xJ -C /out --strip-components=1 \
    && rm -rf /out/CHANGELOG.md /out/LICENSE /out/README.md

FROM alpine:3.20 AS go
ARG GO_VERSION
ARG TARGETARCH
RUN apk add --no-cache curl \
    && curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 600 "https://go.dev/dl/go${GO_VERSION}.linux-${TARGETARCH}.tar.gz" | tar -xz -C /usr/local

FROM alpine:3.20 AS pgdg-key
RUN apk add --no-cache curl gnupg \
    && curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 600 https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /apt.postgresql.org.gpg

FROM codercom/enterprise-base:ubuntu

USER root
COPY --from=pgdg-key /apt.postgresql.org.gpg /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg

# Keep downloaded packages in BuildKit caches (not in the image) and install everything with a single apt-get update.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\n' > /etc/apt/apt.conf.d/99network; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ffmpeg postgresql-client-17 redis-tools iputils-ping build-essential cifs-utils gh python3 python3-venv python3-pip \
        xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 \
        xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic \
        fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
        libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
        libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
        libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
        libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2

# Node (flixer, flixer-web) and Go (flixer-indexer, flixer-streamer) from the official tarballs, so versions match the repos' Dockerfiles.
COPY --from=node /out/ /usr/local/
COPY --from=go /usr/local/go /usr/local/go

ENV PATH=/usr/local/go/bin:/home/coder/go/bin:$PATH
USER coder
