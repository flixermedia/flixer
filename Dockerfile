ARG NODE_VERSION=26.12.0

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
WORKDIR /opt

COPY package.json package-lock.json tsconfig*.json vite.config.ts .barrels.json ./

RUN --mount=type=cache,target=/root/.npm \
	npm ci --no-audit --no-fund

COPY ./src ./src

RUN npm run build

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /opt

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
	npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
	&& find /opt/node_modules -type d \( -name '__tests__' -o -name 'docs' -o -name 'examples' -o -name '.github' \) -prune -exec rm -rf {} + \
	&& find /opt/node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' -o -name '*.md' -o -name 'LICENSE*' -o -name 'LICENCE*' -o -name 'CHANGELOG*' \) -delete

FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version=$APP_VERSION
ENV WORKDIR=/opt \
	PORT=8081 \
	NODE_ENV=production
WORKDIR $WORKDIR

RUN --mount=type=cache,target=/root/.npm \
	apk add --no-cache ca-certificates cifs-utils nfs-utils rclone fuse3 postgresql17-client yt-dlp-core py3-pycryptodomex py3-brotli py3-websockets ffmpeg \
	&& if ! grep -qxF user_allow_other /etc/fuse.conf; then echo user_allow_other >> /etc/fuse.conf; fi \
	&& npm install -g pm2 --no-audit --no-fund

COPY --from=deps --chown=node:node /opt/node_modules ./node_modules
COPY --from=build --chown=node:node /opt/dist ./dist
COPY --chown=node:node package.json processes.config.cjs ./
COPY --chown=node:node resources ./resources
COPY --chown=node:node deploy/proxy/nginx.conf ./resources/nginx.conf

# Named volumes copy this ownership on first use, so the node user can write settings and the shared secret.
RUN mkdir -p /var/lib/flixer/config /run/flixer-secrets /data/backups "$WORKDIR/logs" \
	&& chown node:node "$WORKDIR" "$WORKDIR/logs" /var/lib/flixer /var/lib/flixer/config /run/flixer-secrets /data/backups
USER node

EXPOSE 8081

CMD ["pm2-runtime", "start", "processes.config.cjs", "--env", "production"]
