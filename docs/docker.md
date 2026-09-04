# Docker deployment guide

This fork ships a self-contained Docker setup — no separate packaging repo
needed. The image is built from this source tree and published to GHCR.

## Quick start with compose

```sh
docker compose up -d --build
```

This starts The Lounge on http://localhost:9000 with data persisted in the
`thelounge-data` volume. Then create your first user:

```sh
docker compose exec thelounge node index.js add alice
```

Log in at http://localhost:9000 and add your IRC networks.

## What's inside

- **Multi-stage build** (`Dockerfile`): a Node 24 build stage compiles the
  client and server, and the runtime stage contains only production
  dependencies plus `dist/`, `public/`, `index.js`, `defaults/`, and
  `package.json`. No build tools in the final image (~120 MB).
- **Non-root**: runs as the `node` user. The data volume is chowned on first
  build; if you mount a host directory instead of a named volume, make sure
  it's writable by UID 1000.
- **Data volume**: everything lives under `/home/lounge/data` in the
  container (`config.js`, `users/`, `logs/` with the SQLite message
  databases, uploads). Back up this volume and you can restore anywhere.
- **Healthcheck**: polls `/` every 30 s; unhealthy containers get restarted
  by `restart: unless-stopped` setups and visible status in `docker ps`.

## Manual build and run

```sh
docker build -t thelounge .
docker run -d --name thelounge --restart unless-stopped \
  -p 9000:9000 \
  -v thelounge-data:/home/lounge/data \
  thelounge
```

Useful flags:

| Flag / env               | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `-p 9000:9000`           | Publish the web UI (change the host port as needed) |
| `-v …:/home/lounge/data` | Persist config, users, and message history          |
| `-e TZ=Europe/Berlin`    | Timezone for log timestamps                         |
| `docker logs thelounge`  | Startup log, config path, connected address         |

## Managing users and config

All `node index.js …` commands from the README work via `docker compose exec`:

```sh
docker compose exec thelounge node index.js add alice      # new user
docker compose exec thelounge node index.js --help         # all commands
```

Edit `config.js` inside the volume (`docker volume inspect` to find it, or
bind-mount `./data:/home/lounge/data` for direct access), then restart:

```sh
docker compose restart thelounge
```

## Reverse proxy

Terminate TLS at the proxy and forward plain HTTP + WebSockets. Minimal
Caddy example:

```
chat.example.com {
	reverse_proxy 127.0.0.1:9000
}
```

Nginx equivalent needs the WebSocket upgrade headers:

```
location / {
	proxy_pass http://127.0.0.1:9000;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $scheme;
}
```

If the proxy sets `X-Forwarded-For`/`X-Forwarded-Proto`, enable
`reverseProxy` in `config.js` so IP logging and secure cookies are correct.

## Updates

Published images are rebuilt from `master` on every push
(`.github/workflows/docker.yml`, tags `latest` + branch/tag names):

```sh
docker compose pull   # if using ghcr.io/PUT-Request/thelounge
docker compose up -d
```

For local builds, rebuild after `git pull`:

```sh
git pull
docker compose up -d --build
```

Schema migrations (including the search-index sidecar build, which can take
minutes on multi-million-message histories — see README) run automatically
on startup. The old version keeps working on the same volume if you need to
roll back the image, since message-database migrations are additive.

## Backups

```sh
docker run --rm -v thelounge-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/thelounge-$(date +%F).tar.gz -C /data .
```

Back up `config.js` and `logs/*.sqlite3` at minimum; uploads and packages
are nice to have.

## Migrating a bare-metal install

1. Stop the old instance.
2. Copy its `.thelounge` home (or `THELOUNGE_HOME`) contents into the
   volume: `docker cp ~/.thelounge/. <container>:/home/lounge/data/` or
   extract a backup tarball into the volume.
3. Fix ownership (`chown -R 1000:1000` on a bind mount) and start.

## Troubleshooting

- **Permission denied on `/home/lounge/data`**: the volume isn't writable
  by UID 1000. For named volumes this is handled at build; for bind mounts,
  `chown` it yourself.
- **Port already in use**: change the left side of `ports:` (`"9001:9000"`).
- **Blank page / old UI after update**: hard-refresh; open tabs from before
  a redeploy show a reload banner automatically.
- **First start is slow**: expected on large histories (search-index build);
  watch `docker logs` rather than killing it.
- **Changelog shows an error at boot** (`Failed to fetch changelog: 403`):
  harmless — GitHub rate-limited the anonymous update check.
