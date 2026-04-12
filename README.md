# ownwa

`ownwa` is a self-hosted WhatsApp archive viewer built around manual WhatsApp exports. It takes `.txt` transcripts and `.zip` exports, stores the source material as encrypted blobs, parses the chat history into a searchable relational model, and presents it in a WhatsApp-style reading experience.

The app is intentionally split into two layers:

- a React client for archive browsing, search, import management, and chat reading
- a Node/Express API that handles authentication, ingestion, persistence, search indexing, and attachment delivery

## What The App Does

- Supports per-user accounts, so each user has an isolated archive.
- Accepts WhatsApp `.txt` exports and `.zip` exports with media.
- Stores uploaded source archives as encrypted blobs before processing.
- Parses messages, attachments, event rows, and inferred metadata into PostgreSQL.
- Deduplicates imports by archive hash and deduplicates attachments by content hash.
- Marks outgoing messages based on each user’s saved WhatsApp display name.
- Renders chats in a WhatsApp-like split view with inline image, sticker, and video previews.
- Supports global search and chat-scoped search without storing raw search tokens.
- Tracks import progress with task labels and percentages.

## Documentation

Detailed internal documentation lives in `docs/`:

- [Tech stack](./docs/tech-stack.md)
- [Database schema](./docs/db-schema.md)
- [Import and processing pipeline](./docs/import-pipeline.md)

If you want the fastest high-level understanding, read this README first and then jump to the pipeline doc.

## Product Model

At a high level, `ownwa` works like this:

1. A user uploads a WhatsApp export through the client.
2. The API writes the upload to temporary disk, hashes it, encrypts it, and stores it as a source blob.
3. An `imports` row is created with status and progress metadata.
4. A background worker picks up pending imports.
5. The worker decrypts the source, parses the transcript, upserts chats and participants, inserts deduplicated messages, stores deduplicated attachments, and creates hashed search tokens.
6. The client polls import endpoints and shows progress until the import completes or fails.

## Monorepo Layout

```text
.
├── apps/
│   ├── client/   # React + Vite frontend
│   └── server/   # Express API, import worker, parser, storage logic
├── docs/         # Architecture and implementation docs
├── docker-compose.yml
└── README.md
```

Important server files:

- `apps/server/src/app.ts`: HTTP API wiring, auth/session middleware, route registration, upload handling.
- `apps/server/src/lib.ts`: schema, migrations, parsing, storage, encryption, search, and the import worker.
- `apps/server/tests/`: API, parser, and worker coverage.

Important client files:

- `apps/client/src/App.tsx`: primary application shell, routing, archive workspace, import UI, and import detail UI.
- `apps/client/src/index.css`: visual system and Tailwind-driven styling.

## Tech Stack Summary

Frontend:

- React 19
- React Router 7
- Vite
- Tailwind CSS
- TypeScript

Backend:

- Node.js
- Express 5
- PostgreSQL via `pg`
- Multer for multipart upload handling
- Pino + `pino-http` for logging
- Zod for request validation

Import and storage:

- `jszip` for in-memory zip parsing
- `yauzl` for file-based zip scanning on large archives
- AES-GCM encryption implemented in app code
- Local filesystem or S3-compatible object storage for encrypted blobs

Testing and local development:

- Vitest
- Supertest
- `pg-mem` for in-memory DB-backed tests
- Docker Compose for full-stack local runs

The detailed rationale for each layer is in [docs/tech-stack.md](./docs/tech-stack.md).

## Core Domain Concepts

### User

A registered account with:

- a username
- a password hash
- a saved `selfDisplayName`
- one or more login sessions

The saved display name is important because imports use it to classify which parsed messages should be marked as `isMe`.

### Import

An import is the lifecycle record for one uploaded export. It keeps:

- source file metadata
- source blob storage location
- progress and status
- parse summary
- error state when processing fails

Imports are owner-scoped and deduplicated by archive SHA-256.

### Chat

A chat is the normalized logical conversation in the archive. Chats keep both:

- `source_title`: the best title derived from the import
- `display_title`: the current user-visible title, which can be renamed

### Message

Messages are normalized rows extracted from a transcript. A message may be:

- a normal sender message
- a WhatsApp event/system row
- a call history row

Each message also carries a deterministic fingerprint so overlapping imports do not create duplicate rows.

### Attachment

Attachments represent media or files referenced by messages. Blob storage is content-hash deduplicated per owner, while attachment rows remain message-specific so the same stored blob can appear in multiple messages.

## Features And Behaviors

### Archive browsing

- Split-view layout with conversation list on the left and transcript on the right.
- Chat rename support without changing original source titles.
- Empty states for first-run and sparse archives.

### Search

- Global search across chats.
- Chat-scoped search within a single conversation.
- Search token hashing before persistence, so plaintext terms are not stored in the DB.

### Imports

- `.txt` and `.zip` support.
- Progress reporting with task labels and percentages.
- Retry and clear actions for failed imports.
- Large-file flow that avoids fully loading very large archives into memory.

### Media handling

- Inline previews for images, stickers, and videos.
- Attachment delivery through authenticated API endpoints.
- Range request support for streamed media playback and seeking.

## Security Model

`ownwa` is designed for a self-hosted environment, but it still takes a defense-in-depth approach:

- Passwords are hashed with Argon2id.
- Sessions are stored server-side and issued as HTTP-only cookies.
- Message bodies are encrypted before being written to PostgreSQL.
- Source archives and attachment blobs are encrypted before being written to local disk or S3.
- Search indexes store token HMACs rather than raw terms.
- Imports, chats, messages, attachments, and search tokens are all owner-scoped in queries.

This is not a zero-knowledge system. The server process can decrypt data because it holds the application encryption key.

## Running The App

### Local development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL and create the database referenced by `DATABASE_URL`.
3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

Default dev URLs:

- client: `http://localhost:5173`
- server: `http://localhost:4000`

### Docker Compose

Run the full stack with:

```bash
docker compose up --build
```

Useful URLs:

- app UI: `http://localhost:8080`
- API: `http://localhost:4000`
- PostgreSQL: `localhost:5432`

Compose provisions:

- PostgreSQL 16
- the Node API container
- the Vite-built frontend served by nginx
- a named volume for Postgres data
- a named volume for encrypted blobs

## Environment Variables

Important configuration values:

- `DATABASE_URL`: PostgreSQL connection string.
- `APP_ORIGIN`: allowed browser origin for CORS.
- `SESSION_SECRET`: used for HMAC-based session token hashing.
- `ARCHIVE_ENCRYPTION_KEY`: 32-byte key for message and blob encryption.
- `MAX_IMPORT_BYTES`: max accepted upload size, default 10 GB.
- `UPLOAD_TMP_DIR`: temporary upload and large-import working directory.
- `BLOB_DRIVER`: `local` or `s3`.
- `BLOB_ROOT`: local root for encrypted blob storage when using `local`.
- `S3_REGION`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`: S3-compatible storage configuration.

## Typical User Flow

1. Register or log in.
2. Set the “your name in WhatsApp” value in settings.
3. Upload a `.txt` or `.zip` export from the import modal.
4. Watch import progress as the worker processes the archive.
5. Open a chat, browse messages, preview media, and search across the archive.

## Where To Read Next

- [Tech stack](./docs/tech-stack.md) for repository structure, runtime layers, and key dependencies.
- [Database schema](./docs/db-schema.md) for the relational model and table relationships.
- [Import and processing pipeline](./docs/import-pipeline.md) for the end-to-end ingestion flow from upload to searchable archive.
