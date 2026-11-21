# Dockit

A small, vibe-coded web UI to manage, update and monitor docker compose projects.

> [!WARNING]
> A private fun project, not meant for production. Dockit has access to the docker socket and the projects folder, so anyone who gets into it controls the server. Use rootless docker and don't expose the Dockit container to the internet.

## Setup

Dockit runs as a compose project inside your projects folder, so it shows up in its own list.

```sh
mkdir -p /home/me/docker/dockit && cd /home/me/docker/dockit
curl -fsSLO https://raw.githubusercontent.com/bztes/vibes-dockit/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/bztes/vibes-dockit/main/.env.example -o .env
# adjust PROJECTS_ROOT and ORIGIN in .env
docker compose up -d
```

Open `ORIGIN` (e.g. `http://<server>:3000`) and create the admin account. Without `ORIGIN`, form submissions over plain http fail with 403.

Keep port 3000 inside your LAN or VPN, don't forward it from the router.

### Optional: Caddy for your projects

If you want to make projects reachable under a domain, Dockit comes with a Caddy template that routes domains to them and gets https certificates automatically. You don't need it to use Dockit, and you can use your own reverse proxy instead. Requirements: ports 80 and 443 are free and the domain's DNS record points to the server.

1. **New project** → **Caddy reverse proxy**, optionally enter an email for Let's Encrypt, and deploy it.
2. Open a project → **Domains** tab: route a service and its port to a domain (e.g. `app.example.com`) and deploy. This adds the service to the `caddy` network, no published ports needed.

A domain on the `dockit` project makes Dockit itself public, see the warning above. More sites go into `conf/Caddyfile` of the caddy project.

## Configuration

Settings go into `.env` next to `compose.yaml`:

| Variable          | Description                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `PROJECTS_ROOT`   | **Required.** Absolute path of the folder with the compose projects, e.g. `/home/me/docker`.   |
| `ORIGIN`          | Only for plain http: the URL Dockit is opened with, e.g. `http://server:3000`.                 |
| `DATA_DIR`        | Host path of Dockit's state (settings and SQLite database). Default `./data`.                  |
| `DOCKER_SOCKET`   | Host path of the docker socket. Set it for rootless docker, e.g. `/run/user/1000/docker.sock`. |
| `BODY_SIZE_LIMIT` | Max. request size, limits file uploads in the Files tab. Default `1G`.                         |

The projects folder is mounted with the same path as on the host, so relative bind mounts in your compose files keep working. Dockit's state (settings and SQLite database) lives in `./data`, or in `DATA_DIR` if set.

## Updating

Update Dockit from its own project page, or from the terminal:

```sh
cd /home/me/docker/dockit && docker compose pull && docker compose up -d
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE)
