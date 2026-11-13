# ---- build ---------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime -------------------------------------------------------------
FROM node:24-alpine
# docker cli + compose plugin: Dockit talks to the host daemon through the socket
RUN apk add --no-cache docker-cli docker-cli-compose tini
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./

ENV NODE_ENV=production \
    PORT=3000 \
    DOCKIT_DATA_DIR=/data
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build"]
