# ownwa

Personal WhatsApp archive with per-user accounts, encrypted storage, deduplicated imports, and a WhatsApp-style viewer.

## Product Intent

`ownwa` is built to make manual WhatsApp exports feel like a real messaging app again.

- The main experience is a WhatsApp-like split view: conversation list on the left, active transcript on the right.
- Chat and group names default from the archive filename or transcript filename, including `WhatsApp Chat with {name}` and `WhatsApp Chat - {name}` exports.
- Full-text search runs across all chats, including historical WhatsApp notices and call events.
- Historical rows such as encryption notices, contact notices, and voice/video call history render as centered event bubbles instead of sender messages.
- Photos, videos, GIFs, and stickers render inline in the transcript. Clicking media opens a fullscreen viewer, and videos support inline playback and seeking.
- Your own sender name is stored once as a global per-user setting and applied automatically to new imports.

## Core Behaviors

- Imports are owner-scoped and deduplicated by archive hash.
- Attachments are owner-scoped and deduplicated by content hash, so repeated photos, videos, GIFs, and stickers are stored once per user.
- Messages and imported blobs are encrypted at rest before storage.
- Search indexes token hashes instead of raw plaintext terms.
- Large uploads are written to disk first and support a default 10 GB limit in local and Docker-based setups.

## Stack

- React + Vite + Tailwind
- Node + Express + pino
- PostgreSQL

## Development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL and create the database in `DATABASE_URL`.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.

The server runs on `http://localhost:4000` and the client on `http://localhost:5173`.

## Using The App

1. Register or log in.
2. Set your global “your name in WhatsApp” value in the left sidebar. New imports use this to mark outgoing messages.
3. Use the sidebar import button to open the import modal, then upload a `.txt` or `.zip` WhatsApp export.
4. Open any chat from the left conversation list.
5. Use the global search field to search across all chats and jump directly to matching messages.

The default archive screen is a split-view workspace rather than a dashboard:

- the left rail holds import, search, your saved self-name, recent import activity, and conversation navigation
- the right side shows either an empty transcript state, search results, or the active chat transcript
- import detail pages reuse the same visual system as the main archive workspace

### Transcript Rules

- Standard messages stay left/right aligned based on whether the sender matches your saved global self name.
- Historical WhatsApp events render as centered bubbles.
- Media attachments preview inline when they are image-, sticker-, or video-like formats that the browser can render.
- Non-previewable attachments stay as file chips.

### Chat Titles

- Default title source: archive/transcript name.
- Supported auto-derived patterns:
  - `WhatsApp Chat with Alex.zip`
  - `WhatsApp Chat - Project Room.zip`
  - `Chat with Alex.txt`
- Titles can be renamed in the chat header without changing the original imported source title.

## Docker Compose

Run the full stack for local testing with:

```bash
docker compose up --build
```

If the frontend looks stale after UI changes, restart the stack so Docker rebuilds the client image:

```bash
docker compose down
docker compose up --build -d
```

Services:

- App UI: `http://localhost:8080`
- API: `http://localhost:4000`
- PostgreSQL: `localhost:5432`

Compose provisions:

- a `postgres:16-alpine` database
- the Node API container
- an nginx-served frontend container that proxies `/api` to the server
- named volumes for Postgres data and encrypted archive blobs
- a 10 GB upload cap for large local archive testing, with uploads first written to disk instead of RAM

To stop and remove containers:

```bash
docker compose down
```

To also remove the local database/blob volumes:

```bash
docker compose down -v
```

## Storage

- `BLOB_DRIVER=local` stores encrypted blobs under `BLOB_ROOT`.
- `BLOB_DRIVER=s3` stores encrypted blobs in an S3-compatible bucket.

## Important Environment Variables

- `MAX_IMPORT_BYTES`
  Default: `10737418240` (10 GB).
- `UPLOAD_TMP_DIR`
  Temporary disk location for uploaded archives before processing.
- `ARCHIVE_ENCRYPTION_KEY`
  Required 32-byte key used to encrypt message bodies and stored blobs.
- `BLOB_DRIVER` / `BLOB_ROOT` / `S3_*`
  Controls whether encrypted blobs are stored locally or in S3-compatible object storage.

## Security

- Passwords are hashed with Argon2id.
- Sessions are opaque HTTP-only cookies backed by the database.
- Message bodies and uploaded blobs are encrypted with `ARCHIVE_ENCRYPTION_KEY`.
