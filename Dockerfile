# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json jest.config.js ./
COPY apps ./apps

# Tests run here, as part of the build. There is no Node on the host — every
# build happens inside Docker — so this is the one place they will actually be
# run on every deploy. A failing rule stops the image from being produced,
# which is the point: broken match logic cannot reach the server.
# They need no database, no Redis and no network, so this stays quick.
RUN npx jest --ci

RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/apps/api/src/main.js"]
