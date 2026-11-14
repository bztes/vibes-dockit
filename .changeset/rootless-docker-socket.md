---
'vibes-dockit': patch
---

Support rootless Docker: the socket path can be set with `DOCKER_SOCKET` in `.env`, and the self-update helper and the generated Caddy project now mount the socket Dockit itself was started with instead of a hardcoded `/var/run/docker.sock`.
