# Node is pinned to an exact release, not a moving tag such as node:24-alpine.
# A moving tag is resolved once and then cached on the server, so security
# releases never arrived on their own (Node 20.20.1 ran in production while
# 20.20.2 was out). An exact tag makes every change a visible pull request:
# Dependabot (.github/dependabot.yml) proposes the next release, CI tests it,
# and the deploy smoke-checks it and rolls back if it fails.
# Alpine 3.23 is the release the Node 20 image already ran on, so this change
# moves Node alone; Alpine moves separately when 3.23 nears its end.
# ---- Build stage ----
FROM node:24.22.2-alpine3.23 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json jest.config.js jest.integration.config.js ./
COPY apps ./apps

# Tests run here, as part of the build. There is no Node on the host — every
# build happens inside Docker — so this is the one place they will actually be
# run on every deploy. A failing rule stops the image from being produced,
# which is the point: broken match logic cannot reach the server.
# They need no database, no Redis and no network, so this stays quick.
RUN npx jest --ci

RUN npm run build

# ---- Production stage ----
FROM node:24.22.2-alpine3.23 AS production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/apps/api/src/main.js"]
