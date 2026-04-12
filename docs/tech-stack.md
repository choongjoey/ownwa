# Tech Stack

This document explains the technical shape of `ownwa`: what runs where, why those pieces exist, and how the layers fit together.

## Overview

`ownwa` is a TypeScript monorepo with two primary applications:

- `apps/client`: browser UI
- `apps/server`: HTTP API, import worker, parser, encryption, and persistence layer

The system is intentionally simple:

- the browser talks to a single Express API
- the API writes structured metadata to PostgreSQL
- large binary content is stored as encrypted blobs on local disk or S3
- import processing runs inside the server process as a polling worker

## Stack By Layer

## Frontend

Location: `apps/client`

Primary technologies:

- React 19
- React Router 7
- TypeScript
- Vite
- Tailwind CSS

What the frontend is responsible for:

- authentication screens
- archive workspace routing
- import modal and import detail pages
- conversation list, transcript rendering, and media viewer
- search UI
- polling import state and progress from the API

Why this stack fits:

- React keeps the app stateful and interactive without much ceremony.
- React Router gives route-driven screens for archive, chat, and import detail pages.
- Vite keeps local development fast and frontend builds simple.
- Tailwind is used as the UI styling layer, with most design decisions expressed directly in JSX class strings.

## Backend

Location: `apps/server`

Primary technologies:

- Node.js
- Express 5
- TypeScript
- PostgreSQL via `pg`
- Zod
- Multer
- Pino and `pino-http`

What the backend is responsible for:

- registration, login, logout, and session lookup
- user settings persistence
- import upload endpoints
- import queue and worker execution
- WhatsApp export parsing
- chat/message/attachment persistence
- search token indexing
- attachment serving with range request support

Why this stack fits:

- Express is enough for a focused CRUD + ingest service without heavy framework overhead.
- `pg` keeps DB access explicit and predictable.
- Zod provides lightweight request validation for the relatively small API surface.
- Multer handles multipart upload parsing and safely writes uploads to disk first.
- Pino keeps logs structured and production-friendly.

## Database

Primary technology:

- PostgreSQL

What lives in PostgreSQL:

- users
- sessions
- import lifecycle metadata
- chats
- participants
- messages
- attachment metadata
- hashed search tokens

Why PostgreSQL is a good fit here:

- imports and chats are strongly relational
- transactions matter during import processing
- deduplication relies on unique constraints
- search token lookup benefits from indexes and straightforward SQL

## Blob Storage

Supported backends:

- local filesystem
- S3-compatible object storage

Implementation entry point:

- `createBlobStorage()` in `apps/server/src/lib.ts`

What is stored as blobs:

- encrypted original import sources
- encrypted attachment content

What is not stored as blobs:

- normalized message rows
- import metadata
- chat metadata
- search tokens

Why blobs are separated from PostgreSQL:

- source archives and media can be large
- filesystem or object storage is a better fit for binary payloads
- PostgreSQL stays focused on structured data and queryable indexes

## Encryption And Security Primitives

Application-level encryption is implemented in the server code.

Important pieces:

- AES-GCM for encrypted text and blobs
- Argon2id for password hashing
- HMAC for session token hashing and search token hashing

What is encrypted:

- message bodies before DB storage
- import source blobs before blob storage
- attachment payloads before blob storage

What is hashed:

- uploaded archive SHA-256 for import deduplication
- attachment content SHA-256 for blob deduplication
- token HMACs for search indexing

Why this matters:

- the DB does not contain plaintext message content
- the blob store does not contain plaintext archives or attachments
- search works without storing raw search strings

## Import Processing Strategy

The import worker runs inside the API process rather than as a separate queue service.

Implementation details:

- `ArchiveServices.startWorker()` installs a polling interval
- `ArchiveServices.processPendingImports()` claims pending imports and processes them one at a time
- `kickWorker()` triggers immediate follow-up processing after new imports or retries

Why it is implemented this way:

- the deployment model stays simple
- no extra broker or worker container is required
- the app is easy to run locally and in Docker

Tradeoffs:

- worker throughput is tied to the server process
- horizontal scale would need coordination if multiple server instances process the same DB
- this design is excellent for a self-hosted single-instance deployment, but less suited to large distributed ingestion fleets

## Zip Parsing Strategy

`ownwa` uses two different paths for archive parsing:

- `jszip` for in-memory zip parsing when the archive is already loaded into memory
- `yauzl` for file-based zip scanning when large archives are processed from disk

Why both exist:

- small and medium imports are simpler to handle in memory
- very large imports should not be fully expanded into RAM
- the file-based path supports scanning and extracting large zip contents more safely

## Testing Stack

Primary tools:

- Vitest
- Supertest
- `pg-mem`

What is covered:

- parser behavior
- import worker behavior
- full app flows through HTTP routes

Why `pg-mem` is used:

- tests stay fast
- the DB layer can still exercise real SQL logic
- integration-style tests can run without an external Postgres dependency

## Development Tooling

Top-level scripts:

- `npm run dev`: starts client and server together
- `npm run build`: builds both apps
- `npm test`: runs the server test suite

Server tooling:

- `tsx watch` for server development
- TypeScript compiler for production builds

Client tooling:

- Vite dev server for HMR
- TypeScript compiler + Vite build for production bundles

## Deployment Shape

Local or self-hosted deployment can run in two common modes.

### Development mode

- Vite serves the client
- Express serves the API
- PostgreSQL runs separately

### Docker Compose mode

- nginx serves the built frontend
- Express runs in a Node container
- PostgreSQL runs in its own container
- blobs persist through Docker volumes

This keeps the production runtime small while preserving the same core application structure as local development.

## Directory Guide

### Root

- `package.json`: workspace orchestration
- `docker-compose.yml`: local multi-container deployment
- `README.md`: high-level project overview

### `apps/client`

- `src/App.tsx`: main application, screens, routing, archive interactions
- `src/index.css`: visual system and component styling
- `vite.config.ts`: frontend build/dev setup

### `apps/server`

- `src/app.ts`: Express app setup and route registration
- `src/lib.ts`: schema, parsing, storage, worker, encryption, search
- `tests/`: integration and unit coverage

## Architectural Summary

The stack optimizes for:

- simple self-hosting
- explicit data ownership
- relational clarity
- encrypted storage
- manageable operational complexity

It deliberately does not optimize for:

- distributed queue processing
- multi-service orchestration
- external full-text search infrastructure
- highly abstracted ORM-driven data access

That tradeoff is what gives `ownwa` its current shape: one UI, one API, one database, one blob store, and a clear import worker living close to the domain logic.
