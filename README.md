<h1 align="center">
	<img
		width="300"
		alt="The Lounge"
		src="https://github.com/thelounge/thelounge/blob/master/client/public/img/logo-vertical-transparent-bg.svg?sanitize=true">
</h1>

<h3 align="center">
	Modern web IRC client designed for self-hosting
</h3>

<p align="center">
	<strong>
		<a href="https://thelounge.chat/">Website</a>
		•
		<a href="https://thelounge.chat/docs">Docs</a>
		•
		<a href="https://demo.thelounge.chat/">Demo</a>
	</strong>
</p>
<p align="center">
	<a href="https://demo.thelounge.chat/"><img
		alt="#thelounge IRC channel on Libera.Chat"
		src="https://img.shields.io/badge/Libera.Chat-%23thelounge-415364.svg?colorA=ff9e18"></a>
	<a href="https://github.com/PUT-Request/thelounge/actions"><img
		alt="Build Status"
		src="https://github.com/PUT-Request/thelounge/actions/workflows/build.yml/badge.svg"></a>
</p>

<p align="center">
	<img src="https://raw.githubusercontent.com/thelounge/thelounge.github.io/master/img/thelounge-screenshot.png" width="550">
</p>

This is a modernized fork of [The Lounge](https://github.com/thelounge/thelounge),
the self-hosted web IRC client. It tracks upstream `master` and layers fast,
indexed message search, jump-to-message navigation, and large-history
performance work on top — see [CHANGELOG.md](./CHANGELOG.md) for the full list.

## Highlights

- **Fast, indexed search.** Message history is indexed in a SQLite FTS5 trigram
  sidecar (`NAME.fts.sqlite3` next to each user's `NAME.sqlite3`, rebuilt
  automatically and safe to delete) instead of scanned row by row. Supports
  `from:<nick>`, `datebefore:<date>`, and `dateafter:<date>` filters, session
  resume, auto-loading results, and a jump-to-date picker.
- **Jump to any message.** Click a search result, mention, or notification to
  open a window around it, with highlighted focus, bidirectional history
  browsing, and a return to the live end.
- **Stays smooth on huge histories.** Virtualized message list, incremental
  status-message folding, lazy per-channel history loading, and batched
  storage writes. Recently viewed channels stay warm for instant switching.
- **Modern runtime.** Node.js 22+, Express 5, socket.io 4.8, Vite 8, Vitest 4,
  and refreshed dependencies — see [CHANGELOG.md](./CHANGELOG.md).

To learn more about configuration, usage and features of The Lounge itself,
take a look at [the website](https://thelounge.chat).

The Lounge is the official and community-managed fork of
[Shout](https://github.com/erming/shout), by [Mattias Erming](https://github.com/erming).

## Requirements

- [Node.js](https://nodejs.org/) v22 or more recent (see `.node-version` for the
  pinned version)
- [Yarn](https://yarnpkg.com/) Classic (v1.22.x)

## Running from source

```sh
git clone https://github.com/PUT-Request/thelounge.git
cd thelounge
yarn install --frozen-lockfile
NODE_ENV=production yarn build
yarn start
```

When installed like this, the `thelounge` executable is not created.
Use `node index <command>` to run commands (e.g. `node index --help`).

> ⚠️ This branch tracks upstream development plus modernization work in
> progress. It is generally kept green (`yarn test` passes), but run it at
> your own risk, and avoid running it as root.

## Docker

No separate packaging repo is needed — the image builds straight from this
source tree (multi-stage, non-root, ~120 MB):

```sh
docker build -t thelounge .
docker run -d -p 9000:9000 -v thelounge-data:/home/lounge/data thelounge
```

Or with compose (see [`docker-compose.yml`](./docker-compose.yml)):

```sh
docker compose up -d --build
```

Published images are built from `master` by
[`.github/workflows/docker.yml`](.github/workflows/docker.yml) and pushed to
`ghcr.io/PUT-Request/thelounge` (`:latest` plus branch/tag images).
Pull requests only build the image without pushing.

Data (config, users, logs, message databases) lives in `/home/lounge/data`
— back up that volume. Full guide (reverse proxy, updates, backups,
migration, troubleshooting): [`docs/docker.md`](./docs/docker.md).

## Project layout

| Path                             | Contents                                             |
| -------------------------------- | ---------------------------------------------------- |
| `client/`                        | Vue 3 + Vite web client (components, store, sockets) |
| `server/`                        | Node.js server, TypeScript compiled with `tsc`       |
| `server/plugins/messageStorage/` | SQLite (`node:sqlite`) and text history backends     |
| `shared/`                        | Types and helpers shared by client and server        |
| `test/`                          | Vitest suite (unit, storage, server boot, client)    |
| `defaults/`                      | Default configuration template                       |
| `scripts/`                       | Build, changelog, and maintenance helpers            |
| `public/`, `dist/`               | Build output (generated, not committed)              |

## Common commands

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `yarn dev`              | Start with hot module reloading               |
| `yarn build`            | Build client (`public/`) and server (`dist/`) |
| `yarn build:client`     | Build the web client only                     |
| `yarn build:server`     | Type-check and compile the server only        |
| `yarn test`             | Run all linters and the test suite            |
| `yarn test:vitest`      | Run the test suite only                       |
| `yarn lint`             | Run eslint, prettier check, and stylelint     |
| `yarn githooks-install` | Install the pre-commit lint hook              |

## Message storage notes

- History lives in per-user SQLite files under the `.thelounge` home's `logs/`
  directory. The FTS sidecar (`NAME.fts.sqlite3`) is disposable: deleting it
  triggers an automatic rebuild on next startup.
- Expect roughly 1–3x the message database size in extra disk for the index,
  depending on text entropy, and a one-time backfill proportional to history
  size on first start after upgrading.
- Server settings live in `config.js` in the `.thelounge` home; per-user data
  (including `users/`) follows the upstream layout, so existing installs carry
  over.

## Development setup

Simply follow the instructions to run The Lounge from source above, on your
own fork.

Before submitting any change, make sure to:

- Read the [Contributing instructions](https://github.com/thelounge/thelounge/blob/master/.github/CONTRIBUTING.md#contributing)
- Run `yarn test` to execute linters and the test suite
  - Run `yarn format:prettier` if linting fails
- Run `yarn build:client` if you change or add anything in `client/js` or `client/components`
  - The built files will be output to `public/` by Vite
- Run `yarn build:server` if you change anything in `server/`
  - The built files will be output to `dist/` by tsc
- `yarn dev` can be used to start The Lounge with hot module reloading

To ensure that you don't commit files that fail the linting, you can install
a pre-commit git hook. Execute `yarn githooks-install` to do so.

## License

MIT — see [LICENSE](./LICENSE).
