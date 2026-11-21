# Dockit

A small, vibe-coded web UI to manage, update and monitor docker compose projects.

> [!WARNING]
> A private fun project, not meant for production. Use rootless docker and don't expose it to the internet.

## Setup

Dockit runs as a compose project inside your projects folder, so it shows up in its own list.

```sh
mkdir -p /opt/stacks/dockit && cd /opt/stacks/dockit
curl -fsSLO https://raw.githubusercontent.com/bztes/vibes-dockit/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/bztes/vibes-dockit/main/.env.example -o .env
# adjust PROJECTS_ROOT in .env
docker compose up -d
```

Put Dockit behind a reverse proxy with https, e.g. Caddy, so logins and sessions are not sent in plain text. Then open it and create the admin account.

Plain http (`http://<server>:3000`) only works with `ORIGIN` set to that URL, otherwise form submissions fail with 403.

## Configuration

Settings go into `.env` next to `compose.yaml`:

| Variable          | Description                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `PROJECTS_ROOT`   | **Required.** Absolute path of the folder with the compose projects, e.g. `/opt/stacks`.       |
| `ORIGIN`          | Only for plain http: the URL Dockit is opened with, e.g. `http://server:3000`.                 |
| `DATA_DIR`        | Host path of Dockit's state (settings and SQLite database). Default `./data`.                  |
| `DOCKER_SOCKET`   | Host path of the docker socket. Set it for rootless docker, e.g. `/run/user/1000/docker.sock`. |
| `BODY_SIZE_LIMIT` | Max. request size, limits file uploads in the Files tab. Default `1G`.                         |

The projects folder is mounted with the same path as on the host, so relative bind mounts in your compose files keep working. Dockit's state (settings and SQLite database) lives in `./data`, or in `DATA_DIR` if set.

## Updating

Update Dockit from its own project page, or from the terminal:

```sh
cd /opt/stacks/dockit && docker compose pull && docker compose up -d
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE)
