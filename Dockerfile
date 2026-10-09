# Writers Guild Docker Image
#
# The image mirrors the repository layout (/app/server, /app/shared,
# /app/defaults) so every path the code resolves relative to its own file —
# shared/ imports, the defaults/ character cards — lands where it does in a
# checkout.
#
# Debian slim (glibc) rather than alpine (musl), so better-sqlite3 and sharp
# install from their published linux-x64 / linux-arm64 prebuilds instead of
# compiling from source, which is glacial under QEMU when the arm64 image is
# built on an amd64 runner.
#
# Track the current LTS line explicitly (24) rather than the `lts` tag, so the
# Node major only moves when we move it. The digest is refreshed by dependabot;
# see .github/dependabot.yml.

# Stage 1: Build Vue client
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS client-builder

WORKDIR /app/vue_client

COPY vue_client/package*.json ./
RUN npm ci

COPY shared/ /app/shared/
COPY vue_client/ ./
RUN npm run build

# Stage 2: Install server production dependencies
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS server-deps

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev

# Stage 3: Runtime image
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/
COPY shared/ ./shared/
COPY defaults/ ./defaults/
COPY --from=client-builder /app/vue_client/dist ./server/public/

# All persistent state lives in /data; mount a volume there.
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data

WORKDIR /app/server

EXPOSE 8000

# Use tini for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
