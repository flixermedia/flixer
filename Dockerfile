ARG NODE_VERSION=26.12.0

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /opt

COPY package*.json tsconfig*.json vite.config.ts .barrels.json ./

RUN npm ci

COPY ./src ./src

RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version=$APP_VERSION
ENV WORKDIR /opt
WORKDIR $WORKDIR

RUN apk update && apk add build-base git curl && npm install -g pm2


COPY --from=build /opt .

RUN npm ci --omit=dev --ignore-scripts

COPY processes.config.cjs ./

RUN chown -R node:node "$WORKDIR"
USER node

EXPOSE 8081
ENV PORT 8081
ENV NODE_ENV production

CMD ["pm2-runtime", "start", "processes.config.cjs", "--env", "production"]