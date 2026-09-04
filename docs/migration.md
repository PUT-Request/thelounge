# Migration guide

How to move an existing install to this fork — and how to move back.
No export/import step exists or is needed: every supported move is "point
the new build at the same home directory and start it".

## Compatibility at a glance

| From → to                      | Supported | Notes                                       |
| ------------------------------ | --------- | ------------------------------------------- |
| Upstream `thelounge` → fork    | Yes       | Same database schema; fully reversible      |
| Fork → upstream `thelounge`    | Yes       | Main database is untouched by fork features |
| `tetrahydroc/thelounge` → fork | Yes       | Automatic schema upgrade, see below         |
| Fork → `tetrahydroc/thelounge` | No        | Requires a backup restore, see below        |

The search index lives in a separate disposable file
(`NAME.fts.sqlite3` next to each `NAME.sqlite3`); it is ignored by other
builds and safe to delete. Only the main database matters for
compatibility, and this fork never changes its schema beyond what the
pinned upstream release already defines.

## Before you start (both paths)

1. **Stop the running instance.**
2. **Back up the whole home directory** (default `~/.thelounge`, or
   whatever `THELOUNGE_HOME` points at). At minimum: `config.js`,
   `users/`, and `logs/*.sqlite3`.
3. Note your Node.js version: this fork requires **Node.js ≥ 22**
   (tetra installs may still be on Node 20).

## From upstream `thelounge/thelounge`

Applies to recent upstream releases (4.5.x / 4.6.x pre-releases, i.e. the
line this fork tracks).

1. Back up (above).
2. Replace the installation: fresh `git clone` + `yarn install` (do not
   reuse another install's `node_modules`), or swap the Docker image for
   `ghcr.io/PUT-Request/thelounge`.
3. Point it at the same home directory (`THELOUNGE_HOME`) and start.

What happens on first start:

- Config and user files are used as-is; new settings (e.g. warm-channel
  cache) take their defaults. Removed upstream options, if any, are
  ignored — check the upstream changelog if you skipped several releases.
- The search index builds from existing history. This is proportional to
  stored messages (seconds for small instances, minutes for millions of
  rows) and blocks startup — watch the log, don't kill the process.
- Message history, mentions, uploads, themes, and packages carry over
  untouched.

**Going back** is the same steps in reverse: stop, swap the upstream build
back in, start. Nothing this fork writes to the main database is foreign
to upstream (same schema version, same row layout), and the sidecar file
is simply ignored — delete it if you like.

## From `tetrahydroc/thelounge` (v4.4.3 line)

This is a version upgrade as well as a fork switch (tetra tracks an older
upstream base with its own toolchain).

1. Back up (above). This backup is your **only way back**: tetra's code
   refuses databases newer than its own schema (see below), so do not
   skip this.
2. Make sure Node.js ≥ 22 is installed.
3. Fresh clone of this repo and a fresh dependency install — do **not**
   reuse tetra's `node_modules` (different package manager generation).
4. Point it at the same home directory and start.

What happens on first start:

- The message database migrates forward automatically
  (`1703322560448` → `1784073600000`): a composite history index plus a
  `msgid` column. Existing messages are preserved; the migration itself is
  quick, and the longer step is the search-index build described above.
- Config and user files merge with current defaults. Anything tetra added
  on top of stock The Lounge does not carry over — stock data (networks,
  channels, history, users, uploads) does.
- Installed themes/packages carry over if compatible; outdated ones may
  need reinstalling via `node index.js upgrade`.

**Going back to tetra is not automatic.** Once this fork has opened a
database, its schema version is newer than tetra understands and tetra
will refuse to start on it (`Is The Lounge out of date?`). To go back,
restore the pre-migration backup. There is no downgrade command; the
sidecar file needs no cleanup (tetra never looks at it).

## Moving between bare metal and Docker

The data layout is identical; only the location changes:

```sh
# bare metal -> volume (container stopped)
docker volume create thelounge-data
docker run --rm \
  -v thelounge-data:/to \
  -v "$HOME/.thelounge:/from:ro" \
  alpine sh -c "cp -a /from/. /to/ && chown -R 1000:1000 /to"

# volume -> bare metal
docker run --rm \
  -v thelounge-data:/from:ro \
  -v "$HOME/.thelounge:/to" \
  alpine sh -c "cp -a /from/. /to/"
```

When bind-mounting a host directory instead of a named volume, `chown` it
to UID 1000 first (the container runs as non-root).

## Troubleshooting

- **First start seems hung**: it's building the search index. Check CPU
  and log output; killing it mid-build just restarts the build next time.
- **`Is The Lounge out of date?`**: the database is newer than the running
  build (e.g. tetra opened on a fork-upgraded database). Restore the backup
  or run the newer build.
- **`Cannot find module` / build errors after switching source trees**:
  stale `node_modules`, `dist/`, or `public/`. Remove them and reinstall +
  rebuild from scratch.
- **Wrong Node version**: `node index.js` refuses to start below the
  `engines` range with an explicit error — install Node 22+.
- **Search returns nothing after a restore**: delete the user's
  `NAME.fts.sqlite3` sidecar and restart to force a clean index rebuild.
- **Permission errors in Docker**: see `docs/docker.md`.
