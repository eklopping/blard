# Chat (Public + DMs) — Design Spec

**Date:** 2026-07-22  
**Status:** Approved for implementation planning  
**Repo:** skilling-mmo (blard)  
**Follow-ups (out of scope):** Auction House yellow HUD button, player-to-player trading, market→AH rename

## Goal

Add in-game **public chat** and **private DMs** so players can coordinate simple trade deals. Ship chat first; auction house and face-to-face trading come in later releases.

## Decisions locked

| Topic | Choice |
|--------|--------|
| Release scope | Chat only (public + DMs + personal mutes) |
| Transport | Hybrid: Colyseus for live delivery; Postgres for history / offline DMs |
| Write path | Approach 1 — WorldRoom persists + broadcasts; API serves history/inbox/mutes |
| DM start | Click name in public chat **or** pick/type from online list |
| Moderation v1 | Length + rate limits; **personal mute** (per-player, personalized) |
| Out of v1 | Global block, report/admin, Auction House, P2P trade window |

## UI

### Sidebar order (top → bottom)

1. Brand  
2. Account  
3. **Nav grid** — Inventory / Bank / Market / Profiles / Log out (unchanged position between brand and Skills)  
4. Skills  
5. **Chat block** (new, always visible while in-game)  
6. Panel body (Inventory / Bank / Market content) — **compressed** so chat fits (especially Bank)

### Chat block

- Default view: **Public** feed + compose input  
- Top control: **Public | Inbox**  
- **Inbox:** list of prior DM threads with previews; open a thread to read full history and reply  
- Active DM thread replaces the feed until the player returns to Public or Inbox  
- Mute / unmute available on a public chat name and in the DM thread header  
- Auction House yellow button is **not** added in this release (reserved for a later update)

## Architecture

```
Client (React HUD)
  ├─ send live: Colyseus WorldRoom intents (chat:public / chat:dm)
  ├─ load history: GET Fastify /chat/*
  └─ filter muted senders locally; history also filtered server-side

WorldRoom (game-server)
  ├─ validate length + rate limit
  ├─ persist ChatMessage via Prisma
  ├─ PUBLIC → broadcast to room
  └─ DIRECT → send to sender + recipient if online

API (Fastify)
  ├─ GET /chat/public
  ├─ GET /chat/inbox
  ├─ GET /chat/dm/:threadId
  └─ GET|POST|DELETE /chat/mutes
```

**Online player picker:** use WorldRoom synced `players` state (id + name) — no separate `/chat/online` endpoint in v1. DMs may still be opened to offline players via an existing thread in Inbox; starting a brand-new DM requires the target to appear in the online list or a clickable name from public chat history (history embeds `senderId` + `senderName`).

### Client join sequence

1. Connect WorldRoom (existing JWT auth)  
2. Fetch public history, inbox, and mute list via API  
3. Subscribe to live `ChatMessage` / `DmMessage` room messages  
4. Append to the active feed; update Inbox when a DM arrives for another thread  

### Shared package

Extend `@skilling-mmo/shared` `ClientMessage` / `ServerMessage` with chat/DM payload types and constants (max length, rate limits).

## Data model

### `ChatMessage`

| Field | Type | Notes |
|--------|------|--------|
| `id` | String (cuid) | PK |
| `channel` | `PUBLIC` \| `DIRECT` | enum |
| `senderId` | String | FK → Player |
| `recipientId` | String? | Required when `DIRECT` |
| `threadKey` | String? | DMs: sorted `minId:maxId` so both sides share one thread |
| `body` | String | Trimmed; max 200 chars |
| `senderName` | String | Snapshot at send time (stable history if rename later) |
| `createdAt` | DateTime | |

**Indexes:** `(channel, createdAt)` for public scrollback; `(threadKey, createdAt)` for DM threads; `(recipientId, createdAt)` for inbox helpers.

### `ChatMute`

| Field | Type | Notes |
|--------|------|--------|
| `id` | String (cuid) | PK |
| `playerId` | String | Who is muting |
| `mutedPlayerId` | String | Who is muted |
| `createdAt` | DateTime | |

**Unique:** `(playerId, mutedPlayerId)`.

### Inbox derivation

- Threads = distinct `threadKey` where the current player is sender or recipient  
- Preview = latest message per thread  
- Unread counts optional; v1 may omit or add a simple cursor later if needed  

### Mute behavior

- Personalized only: muted players’ public and DM messages are hidden for the muter  
- Messages still persist; they become visible again if unmuted  
- Game-server still broadcasts; client filters live; API filters history using the mute list  
- Cannot mute self  

### v1 constants

| Constant | Value |
|----------|--------|
| Max body length | 200 |
| Public rate limit | ~1 message / 1s per player |
| DM rate limit | ~1 message / 0.5s per player |
| Public history page | last 50 |
| DM thread page | last 50 |

## Errors & edge cases

| Case | Behavior |
|------|----------|
| Empty / too long | Reject; no persist |
| Rate limited | Soft error in chat UI (“slow down”) |
| DM to unknown / self | Reject |
| Mute self | Reject |
| Recipient offline | Persist; visible in Inbox/history on next load |
| Muted sender | Stored; filtered from live UI + history while muted |
| Auth failure | Existing JWT / room auth errors |

## Testing

- API: create public + DM messages; list inbox/history; mute uniqueness; history respects mutes  
- Manual / light game-server smoke: rate limit, live public broadcast, live DM to online recipient  
- Deploy: pull + `DEPLOY_MODE=source` on VM after merge (existing path)

## Explicit non-goals (this release)

- Auction House UI / yellow nav button  
- Face-to-face trade window  
- Block (prevent incoming DMs)  
- Report / admin moderation tooling  
- Replacing or renaming the existing Market order book  

## Future hooks (do not build now)

- AH / trade notifications as system or typed chat messages  
- Redis pub/sub fanout when multiple WorldRooms exist  
- Unread badges / read cursors  
- Guild or zone channels on the same `ChatMessage` model
