# vibes-dockit

## 0.4.0

### Minor Changes

- [`915c5ee`](https://github.com/bztes/vibes-dockit/commit/915c5ee18fd0966e2fd64b360f35c88dbd77b835) Thanks [@bztes](https://github.com/bztes)! - Caddy uses a Caddyfile, domain changes apply without recreating containers.

- [`6299121`](https://github.com/bztes/vibes-dockit/commit/629912175b9264addf1b44021ef640ad734b3250) Thanks [@bztes](https://github.com/bztes)! - Dockit no longer runs docker actions on its own project, use the terminal for that.

### Patch Changes

- [`f546d61`](https://github.com/bztes/vibes-dockit/commit/f546d616040ab06d807b7fe82d1321bf7e2806fb) Thanks [@bztes](https://github.com/bztes)! - Deleting a project no longer shows an error.

- [`1db0136`](https://github.com/bztes/vibes-dockit/commit/1db0136d91f935c230493c72377c8b1066e21eef) Thanks [@bztes](https://github.com/bztes)! - Show the output of failing health checks on the containers tab.

## 0.3.0

### Minor Changes

- [`0915cd9`](https://github.com/bztes/vibes-dockit/commit/0915cd937c4870b93bd4515577605827f3f4680d) Thanks [@bztes](https://github.com/bztes)! - Add a Dynamic DNS template.

- [`34a4de3`](https://github.com/bztes/vibes-dockit/commit/34a4de3d0b78e46a866ca5caa7398fbe6507f0a6) Thanks [@bztes](https://github.com/bztes)! - Notification channels are now stored per user in the database, with a single admin-managed SMTP server shared by all email channels.

- [`bfc3440`](https://github.com/bztes/vibes-dockit/commit/bfc3440552055dd9199aaa5cfda3fa68612956c9) Thanks [@bztes](https://github.com/bztes)! - Add a Files tab to projects

- [`f203969`](https://github.com/bztes/vibes-dockit/commit/f20396983147507c1f7c5e46c6e3d224c7b54fe2) Thanks [@bztes](https://github.com/bztes)! - Add project templates; Caddy setup is now a template that adds the Domains tab.

### Patch Changes

- [`c14ac6c`](https://github.com/bztes/vibes-dockit/commit/c14ac6ce6139702142e544f699b6b78520b52b2b) Thanks [@bztes](https://github.com/bztes)! - Creating a project no longer deploys it.

- [`e7a0524`](https://github.com/bztes/vibes-dockit/commit/e7a052476e15b1cfdbf952b2debdf49c8ccd8610) Thanks [@bztes](https://github.com/bztes)! - Support rootless Docker: the socket path can be set with `DOCKER_SOCKET` in `.env`, and the self-update helper and the generated Caddy project now mount the socket Dockit itself was started with instead of a hardcoded `/var/run/docker.sock`.

## 0.2.0

### Minor Changes

- [`41e973f`](https://github.com/bztes/vibes-dockit/commit/41e973f3cf43c47d24b61cd731d134ff219251ba) Thanks [@bztes](https://github.com/bztes)! - Initial release of Dockit: a small web UI to manage, update and monitor docker compose projects (compose/.env editing, deploy/start/stop/pull controls, live status and logs, registry update checks with optional auto updates, notifications, multi-user setup, Caddy integration).
