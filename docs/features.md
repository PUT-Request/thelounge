# Fork features

What this fork adds on top of upstream The Lounge, and where each thing
is configured. All features degrade gracefully when the server or the
admin configuration does not support them.

## IRCv3

Negotiated automatically per network; nothing to configure.

- **CHATHISTORY**: channels backfill recent server-side history on join
  (only when local history is thin, so reconnects do not refetch), and a
  _"Load older messages from server"_ button appears once local history
  runs out. Playback is stored to SQLite, deduped, and never bumps
  unread, highlights, mentions, or notifications. Rejected fetches show
  the server's error in-channel.
- **Also requested**: `invite-notify`, `userhost-in-names`,
  `draft/chathistory` (pre-ratification fallback name).
- **Already carried over from upstream support**: `echo-message`,
  `server-time`, `message-ids`, `+reply` threading, `multiline`,
  `standard-replies`, `away-notify`, `account-notify`, `extended-join`,
  `MONITOR`, `setname`, `chghost`, `message-tags`, `batch`, typing
  notifications.
- **Tracked identity**: sender services accounts (account-tag,
  extended-join, account-notify) and user@host (userhost-in-names, WHO,
  joins) are stored on users and messages. Right-clicking a user shows
  the tracked account and host mask in the context menu; `/whois`
  output is unchanged and complete.

Deliberately not implemented: draft capabilities (`message-redaction`,
`read-marker`, `event-playback`, `metadata`), `no-implicit-names`,
SASL mechanisms beyond plain/external.

## Tracker community features

- **Shoutbox bridge beautification** (Settings -> Appearance -> Bridged
  messages): bot-relayed cross-platform chat from 21 supported sites is
  split back into real nicknames, with parentheses or plain display.
- **BBCode rendering**: quote (with attribution), spoiler, note, alert,
  tables, lists, url/img/video, and inline formatting render as rich
  content; anything else falls back to plain IRC formatting.
- **Tracker profile links**: right-click a channel or user to open
  their tracker profile. Sites are configured in `config.js`
  (`torrentSites`, keyed by IRC host with optional channel scoping);
  entries with `disabled: true` stay hidden.
- **Seedpool-style user groups** (SPGROUPS/SPJOIN): channels group the
  user list by server-provided groups when available.
- **`/rainbow` (`/rgb`)**: rainbow-colorizes text, with a disableable
  `Ctrl/Cmd+R` hotkey (Settings -> Appearance).

## Chat workflow

- **Collapsible Direct Messages** section in the sidebar with filtering,
  pinning (context menu, persisted per query), unread badges, and
  show more/less.
- **Quote reply** (opt-in, Settings -> Appearance -> Messages): pastes a
  styled IRC quote into the input on any network. Native protocol
  replies are untouched.
- **Pending invitations** (`/invites`): direct channel invites notify
  like mentions, are tracked per network, and can be joined or
  dismissed from the Invites window. Joining clears the entry.
- **Mass-event aggregation** (`config.js` -> `massEventDetection`):
  netsplits and reconnect floods collapse into one summary message
  (threshold, window, cooldown, max duration, and post-event NAMES
  refresh are all tunable).

## File uploads

Settings -> General -> File uploads (requires `fileUpload.enable` plus
`allowFileUploadBackendSelection` in `config.js`):

- Local hosting with optional per-file retention (1h–1mo, custom
  seconds, or never), swept hourly.
- Relay backends: ImageBB, catbox, Uguu, qu.ax, ptpimg, OnlyImage,
  XBackBone and others, each with API key / custom URL / TTL pickers.
- `maskFileHost` rewrites externally hosted URLs through
  `fileUpload.baseUrl` for vanity/proxied setups.
