# vibes-dockit

## 0.10.0

### Minor Changes

- [`79208c8`](https://github.com/bztes/vibes-dockit/commit/79208c80c64df299bc43cb0d01ef40f1ba3a5146) Thanks [@bztes](https://github.com/bztes)! - Delete backup snapshots

- [`add74d7`](https://github.com/bztes/vibes-dockit/commit/add74d7d0cae0f76ca70ed88f85ddf844eec35f3) Thanks [@bztes](https://github.com/bztes)! - Browse and check backup exclude paths

## 0.9.0

### Minor Changes

- [`3c3f1fe`](https://github.com/bztes/vibes-dockit/commit/3c3f1fe4717527eac709598fac159dbe6e3404af) Thanks [@bztes](https://github.com/bztes)! - Add a /health endpoint, used by the Docker health check

- [`1ec8c44`](https://github.com/bztes/vibes-dockit/commit/1ec8c449a3020dd6854fb6c55710f40fd1b44ca6) Thanks [@bztes](https://github.com/bztes)! - Show concurrent jobs as tabs in the job output panel

## 0.8.0

### Minor Changes

- [`25a2ca2`](https://github.com/bztes/vibes-dockit/commit/25a2ca256ce5f15397364f735a9e723889e92da8) Thanks [@bztes](https://github.com/bztes)! - Keep unsaved edits when switching between tabs and projects

- [`4e8474f`](https://github.com/bztes/vibes-dockit/commit/4e8474f9027e4bfb6be369c4e22ab97bfa67de12) Thanks [@bztes](https://github.com/bztes)! - Log in to registries for private images

- [`e0d779f`](https://github.com/bztes/vibes-dockit/commit/e0d779f26773056a94d9c97dd70fb172482bb299) Thanks [@bztes](https://github.com/bztes)! - Show the running Dockit version in the settings

### Patch Changes

- [`55bb0ff`](https://github.com/bztes/vibes-dockit/commit/55bb0ff0d9b6961dcf6d751ba96a9776bc4f046c) Thanks [@bztes](https://github.com/bztes)! - Fix the UI freezing after switching between a few projects or tabs

- [`352fa08`](https://github.com/bztes/vibes-dockit/commit/352fa08802bbad8235dfbf3d24969e28818dd8fd) Thanks [@bztes](https://github.com/bztes)! - Stop Dockit's own environment variables from overriding a project's .env

- [`f9d957b`](https://github.com/bztes/vibes-dockit/commit/f9d957b0206a317ddb3637653c7c34fdc444fbcb) Thanks [@bztes](https://github.com/bztes)! - Only flag published ports that a Caddy route already uses

- [`c9c430c`](https://github.com/bztes/vibes-dockit/commit/c9c430c1695176850bb1238c3ac1ba0f4edc474d) Thanks [@bztes](https://github.com/bztes)! - Improve the shared UI components

- [`5744f15`](https://github.com/bztes/vibes-dockit/commit/5744f15274519456efb3be3cc688e6d8238df249) Thanks [@bztes](https://github.com/bztes)! - Fix the narrow SMTP password field

## 0.7.0

### Minor Changes

- [`b6324cc`](https://github.com/bztes/vibes-dockit/commit/b6324cc81fb8c5b27ea1eb3d6d09c41cc60471e5) Thanks [@bztes](https://github.com/bztes)! - Set the data folder of the compose setup with DATA_DIR

- [`47d0a43`](https://github.com/bztes/vibes-dockit/commit/47d0a430fe95f79e9475d8af02b60c1e5a590f79) Thanks [@bztes](https://github.com/bztes)! - Edit the .env file as text to keep comments

- [`7d56a56`](https://github.com/bztes/vibes-dockit/commit/7d56a56167bd234a343cbf4cee636ca198a4eaed) Thanks [@bztes](https://github.com/bztes)! - Rename DOCKIT_DATA_DIR to DATA_DIR

- [`47d0a43`](https://github.com/bztes/vibes-dockit/commit/47d0a430fe95f79e9475d8af02b60c1e5a590f79) Thanks [@bztes](https://github.com/bztes)! - Mark secrets in .env with # @sensitive instead of # dockit:secret

## 0.6.0

### Minor Changes

- [`677fb23`](https://github.com/bztes/vibes-dockit/commit/677fb2336dd4b0fb0885075bc4ffb57bdc5c99d8) Thanks [@bztes](https://github.com/bztes)! - Mount Caddy certificates into services

- [`6e2de56`](https://github.com/bztes/vibes-dockit/commit/6e2de561bc58a565f0baab25ea954b916a7483c3) Thanks [@bztes](https://github.com/bztes)! - Keep Dockit settings in `dockit.json` and compose changes in the override file

- [`9a46d20`](https://github.com/bztes/vibes-dockit/commit/9a46d2011800eec36412e7d66b3b960d2b265018) Thanks [@bztes](https://github.com/bztes)! - Add a restic backup template

- [`5308e58`](https://github.com/bztes/vibes-dockit/commit/5308e58e511f6178818ce881a27f83ed86bc23b5) Thanks [@bztes](https://github.com/bztes)! - Run restic backup hooks in the restic container with `docker exec`

- [`869289d`](https://github.com/bztes/vibes-dockit/commit/869289d0cd93dc04c633221ccfa42f3e5159f0d0) Thanks [@bztes](https://github.com/bztes)! - Add backup hooks to the restic template, e.g. database dumps

### Patch Changes

- [`a93640a`](https://github.com/bztes/vibes-dockit/commit/a93640a95b1205f3b8c33ff2e6ffa92344969812) Thanks [@bztes](https://github.com/bztes)! - Stop dialog scrolling from scrolling the page behind it

- [`5fc8b33`](https://github.com/bztes/vibes-dockit/commit/5fc8b33b84c307144221369455a19a8fae67c7f4) Thanks [@bztes](https://github.com/bztes)! - Keep dialog header and footer visible while the content scrolls

- [`e2ac284`](https://github.com/bztes/vibes-dockit/commit/e2ac2846fbacc62d066bca3ab15c6bb6f61bffb6) Thanks [@bztes](https://github.com/bztes)! - Base the docker image on Debian like the other vibes projects

- [`5f0156e`](https://github.com/bztes/vibes-dockit/commit/5f0156e51dbb83fe81ffee56efc7dc2fe7d56c0b) Thanks [@bztes](https://github.com/bztes)! - Let the file editor grow with its content instead of scrolling

- [`b88d99e`](https://github.com/bztes/vibes-dockit/commit/b88d99e8e9ea40b8a117adf8028ae7dbec2d28e7) Thanks [@bztes](https://github.com/bztes)! - Publish the docker image to ghcr.io

- [`bbeacd5`](https://github.com/bztes/vibes-dockit/commit/bbeacd5ff886a226376ce3782446bbe8876c0a2e) Thanks [@bztes](https://github.com/bztes)! - Reset project tabs when switching projects

- [`f6bbe67`](https://github.com/bztes/vibes-dockit/commit/f6bbe6797187c06c316d104c393aed4a5f8f63ff) Thanks [@bztes](https://github.com/bztes)! - Give each project tab its own URL

## 0.5.1

### Patch Changes

- [`12d1e84`](https://github.com/bztes/vibes-dockit/commit/12d1e84dfa31050cca8d65a3b33c1cdfac7528e3) Thanks [@bztes](https://github.com/bztes)! - Fix the arm64 docker build

## 0.5.0

### Minor Changes

- [`d19877c`](https://github.com/bztes/vibes-dockit/commit/d19877c85d5715aa0d1d76aad67a4f71ff61de60) Thanks [@bztes](https://github.com/bztes)! - Add a resource overview of all containers, images, networks and volumes.

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
