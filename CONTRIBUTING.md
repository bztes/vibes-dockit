# Contributing

## Development

Requires Node.js 24+, pnpm (via corepack) and a running docker daemon.

```sh
corepack enable
pnpm install
cp .env.example .env   # set PROJECTS_ROOT to a folder with test projects
pnpm dev
```

The dev server runs on `http://localhost:5173`. Data (`dockit.db`, `config.json`) goes into `./data`, change it with `DOCKIT_DATA_DIR`.

## Checks

```sh
pnpm check   # svelte-check / typescript
pnpm lint    # prettier + eslint
pnpm format  # fix formatting
pnpm test    # unit tests (server + browser via playwright)
```

## Database

The schema lives in [src/lib/server/db/schema.ts](src/lib/server/db/schema.ts). After changing it, generate a migration:

```sh
pnpm db:generate
```

Migrations in [drizzle/](drizzle/) are applied automatically on server start.

## Commits and releases

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
- User-facing changes get a changeset: `pnpm changeset`, with a short one-line description.
- On push to `main` the release workflow opens a `chore: release` PR. Merging it bumps the version, updates [CHANGELOG.md](CHANGELOG.md), tags `vX.Y.Z` and publishes the docker image to `ghcr.io/bztes/vibes-dockit`.

## Docker image

```sh
docker build -t vibes-dockit .
```
