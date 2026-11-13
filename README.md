# Dockit

A small, vibe-coded web UI to manage, update and monitor docker compose projects.

## Setup

```sh
mkdir -p /opt/stacks/dockit && cp compose.yaml .env.example /opt/stacks/dockit/
cd /opt/stacks/dockit && mv .env.example .env   # adjust PROJECTS_ROOT=/opt/stacks and ORIGIN
docker compose up -d
```

Open `http://<server>:3000` and create the admin account.
