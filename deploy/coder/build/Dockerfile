FROM codercom/enterprise-base:ubuntu

ARG NODE_VERSION=26.12.0
ARG GO_VERSION=1.26.0

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg postgresql-client redis-tools build-essential \
    && rm -rf /var/lib/apt/lists/*

# Node (flixer, flixer-web) and Go (flixer-indexer, flixer-streamer) from the official tarballs, so versions match the repos' Dockerfiles.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    node_arch="$([ "$arch" = arm64 ] && echo arm64 || echo x64)"; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" | tar -xJ -C /usr/local --strip-components=1; \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" | tar -xz -C /usr/local

ENV PATH=/usr/local/go/bin:/home/coder/go/bin:$PATH
USER coder
