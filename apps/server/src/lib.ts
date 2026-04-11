import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import argon2 from "argon2";
import JSZip from "jszip";
import mime from "mime-types";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID
} from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Logger } from "pino";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export type BlobDriverKind = "local" | "s3";

export interface AppConfig {
  databaseUrl: string;
  port: number;
  sessionSecret: string;
  appOrigin: string;
  encryptionKey: Buffer;
  maxImportBytes: number;
  uploadTmpDir: string;
  blobDriver: BlobDriverKind;
  blobRoot: string;
  s3Region?: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;
}

export interface SafeUser {
  id: string;
  username: string;
  createdAt: string;
}

interface UserRow extends QueryResultRow {
  id: string;
  username: string;
  password_hash: string;
  self_display_name: string | null;
  created_at: Date | string;
}

interface SessionRow extends QueryResultRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date | string;
}

interface ImportRow extends QueryResultRow {
  id: string;
  owner_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  file_name: string;
  file_sha256: string;
  source_blob_key: string;
  source_blob_storage: BlobDriverKind;
  source_blob_metadata: string;
  source_size: number | string;
  source_chat_title: string;
  normalized_chat_title: string;
  import_options: string;
  parse_summary: string;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

interface ChatRow extends QueryResultRow {
  id: string;
  owner_id: string;
  source_title: string;
  display_title: string;
  title_overridden: boolean;
  normalized_title: string;
  last_import_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ParticipantRow extends QueryResultRow {
  id: string;
  chat_id: string;
  display_name: string;
  normalized_name: string;
}

interface MessageRow extends QueryResultRow {
  id: string;
  owner_id: string;
  chat_id: string;
  sender_name: string;
  normalized_sender_name: string;
  message_timestamp: Date | string | null;
  original_timestamp_label: string;
  body_encrypted: string;
  is_me: boolean;
  has_attachments: boolean;
  message_kind: "message" | "event";
  event_type: "system" | "call" | null;
  message_fingerprint: string;
  created_at: Date | string;
}

interface AttachmentRow extends QueryResultRow {
  id: string;
  owner_id: string;
  chat_id: string;
  message_id: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number | string;
  content_sha256: string | null;
  storage_driver: BlobDriverKind | null;
  blob_key: string | null;
  blob_metadata: string;
  placeholder_text: string | null;
}

interface AttachmentRecord {
  fileName: string;
  normalizedName: string;
  archivePath?: string;
  buffer?: Buffer;
  contentSha256?: string;
  byteSize: number;
  mimeType: string | null;
  placeholderText: string | null;
}

interface ParsedMessage {
  sender: string;
  normalizedSender: string;
  rawTimestampLabel: string;
  timestampIso: string | null;
  content: string;
  isMe: boolean;
  messageKind: "message" | "event";
  eventType: "system" | "call" | null;
  attachments: AttachmentRecord[];
}

export interface ParsedArchive {
  chatTitle: string;
  normalizedChatTitle: string;
  transcriptName: string;
  withMedia: boolean;
  messages: ParsedMessage[];
}

interface ChatListRow extends QueryResultRow {
  id: string;
  source_title: string;
  normalized_title: string;
  message_count: number | string;
  attachment_count: number | string;
  last_message_at: Date | string | null;
  updated_at: Date | string;
}

interface SenderStatsRow extends QueryResultRow {
  sender_name: string;
  total: number | string;
}

export interface AuthResult {
  user: SafeUser;
  sessionToken: string;
}

export interface BlobPointer {
  storageDriver: BlobDriverKind;
  blobKey: string;
  metadata: string;
}

export interface ArchiveServicesOptions {
  db: Pool;
  logger: Logger;
  config: AppConfig;
  storage: BlobStorage;
}

interface CreateImportOptions {
  selfDisplayName?: string;
}

export interface UserSettings {
  selfDisplayName: string;
}

interface ImportSummary {
  transcriptName: string;
  messagesParsed: number;
  messagesInserted: number;
  attachmentsLinked: number;
  attachmentsStored: number;
  participants: number;
  withMedia: boolean;
}

interface ParsedJsonObject {
  [key: string]: unknown;
}

type Queryable = Pool | PoolClient;

export const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  self_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  source_blob_key TEXT NOT NULL,
  source_blob_storage TEXT NOT NULL,
  source_blob_metadata TEXT NOT NULL DEFAULT '{}',
  source_size BIGINT NOT NULL,
  source_chat_title TEXT NOT NULL,
  normalized_chat_title TEXT NOT NULL,
  import_options TEXT NOT NULL DEFAULT '{}',
  parse_summary TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  UNIQUE(owner_id, file_sha256)
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_title TEXT NOT NULL,
  display_title TEXT NOT NULL,
  title_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  normalized_title TEXT NOT NULL,
  last_import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, normalized_title)
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  sender_participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  normalized_sender_name TEXT NOT NULL,
  message_timestamp TIMESTAMPTZ,
  original_timestamp_label TEXT NOT NULL,
  body_encrypted TEXT NOT NULL,
  is_me BOOLEAN NOT NULL DEFAULT FALSE,
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  message_kind TEXT NOT NULL DEFAULT 'message',
  event_type TEXT,
  message_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, message_fingerprint)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  mime_type TEXT,
  byte_size BIGINT NOT NULL DEFAULT 0,
  content_sha256 TEXT,
  storage_driver TEXT,
  blob_key TEXT,
  blob_metadata TEXT NOT NULL DEFAULT '{}',
  placeholder_text TEXT,
  attachment_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, attachment_fingerprint)
);

CREATE TABLE IF NOT EXISTS message_search_tokens (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_imports_owner_status ON imports (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_owner_updated ON chats (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages (chat_id, message_timestamp, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_owner_import ON messages (owner_id, import_id);
CREATE INDEX IF NOT EXISTS idx_attachments_owner_sha ON attachments (owner_id, content_sha256);
CREATE INDEX IF NOT EXISTS idx_search_tokens_lookup ON message_search_tokens (owner_id, chat_id, token_hash);
CREATE INDEX IF NOT EXISTS idx_search_tokens_owner_lookup ON message_search_tokens (owner_id, token_hash);
`;

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const sessionSecret = env.SESSION_SECRET?.trim() || "development-session-secret";
  const rawKey =
    env.ARCHIVE_ENCRYPTION_KEY?.trim() ||
    Buffer.from("development-encryption-key-12345").toString("base64");
  const encryptionKey = parseEncryptionKey(rawKey);
  return {
    databaseUrl: env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ownwa",
    port: Number(env.PORT || 4000),
    sessionSecret,
    appOrigin: env.APP_ORIGIN || "http://localhost:5173",
    encryptionKey,
    maxImportBytes: Number(env.MAX_IMPORT_BYTES || 10737418240),
    uploadTmpDir: env.UPLOAD_TMP_DIR ? path.resolve(env.UPLOAD_TMP_DIR) : path.resolve(process.cwd(), "tmp/uploads"),
    blobDriver: env.BLOB_DRIVER === "s3" ? "s3" : "local",
    blobRoot: env.BLOB_ROOT ? path.resolve(env.BLOB_ROOT) : path.resolve(process.cwd(), "archive-blobs"),
    s3Region: env.S3_REGION,
    s3Bucket: env.S3_BUCKET,
    s3Endpoint: env.S3_ENDPOINT,
    s3AccessKeyId: env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  };
}

export async function hashFileSha256(filePath: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  const fileStats = await stat(filePath);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return {
    sha256: hash.digest("hex"),
    size: fileStats.size
  };
}

function parseEncryptionKey(raw: string): Buffer {
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) {
    return base64;
  }
  const hex = Buffer.from(raw, "hex");
  if (hex.length === 32) {
    return hex;
  }
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }
  throw new Error("ARCHIVE_ENCRYPTION_KEY must decode to exactly 32 bytes");
}

export async function runMigrations(db: Queryable): Promise<void> {
  await db.query(schemaSql);
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS self_display_name TEXT");
  await db.query("ALTER TABLE imports ALTER COLUMN source_size TYPE BIGINT");
  await db.query("ALTER TABLE chats ADD COLUMN IF NOT EXISTS display_title TEXT");
  await db.query(
    "ALTER TABLE chats ADD COLUMN IF NOT EXISTS title_overridden BOOLEAN NOT NULL DEFAULT FALSE"
  );
  await db.query(
    "UPDATE chats SET display_title = source_title WHERE display_title IS NULL OR display_title = ''"
  );
  await db.query("ALTER TABLE chats ALTER COLUMN display_title SET NOT NULL");
  await db.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_kind TEXT NOT NULL DEFAULT 'message'"
  );
  await db.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS event_type TEXT");
  await db.query("ALTER TABLE attachments ALTER COLUMN byte_size TYPE BIGINT");
  await db.query(
    "CREATE INDEX IF NOT EXISTS idx_search_tokens_owner_lookup ON message_search_tokens (owner_id, token_hash)"
  );
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toIso(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hmacHex(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function deriveChatTitle(fileName: string): string {
  const clean = stripExtension(path.basename(fileName));
  return clean
    .replace(/^WhatsApp Chat with /i, "")
    .replace(/^WhatsApp Chat\s*-\s*/i, "")
    .replace(/^Chat with /i, "")
    .trim();
}

function buildMessageFingerprint(message: ParsedMessage): string {
  const attachmentSignature = message.attachments
    .map((attachment) => attachment.contentSha256 || attachment.normalizedName || attachment.placeholderText || "")
    .sort()
    .join("|");
  const canonical = [
    message.timestampIso || message.rawTimestampLabel,
    message.normalizedSender,
    message.messageKind,
    message.eventType || "",
    normalizeWhitespace(message.content),
    attachmentSignature
  ].join("||");
  return sha256Hex(canonical);
}

function buildAttachmentFingerprint(attachment: AttachmentRecord): string {
  return sha256Hex(
    [attachment.normalizedName, attachment.contentSha256 || "", attachment.placeholderText || ""].join("||")
  );
}

function encryptBytes(input: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]);
}

function decryptBytes(input: Buffer, key: Buffer): Buffer {
  if (input.length < 29 || input[0] !== 1) {
    throw new Error("Unsupported encrypted payload");
  }
  const iv = input.subarray(1, 13);
  const tag = input.subarray(13, 29);
  const ciphertext = input.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptText(input: string, key: Buffer): string {
  return encryptBytes(Buffer.from(input, "utf8"), key).toString("base64");
}

function decryptText(input: string, key: Buffer): string {
  return decryptBytes(Buffer.from(input, "base64"), key).toString("utf8");
}

function tokeniseForSearch(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z0-9][a-z0-9'_-]*/g) || [];
  return Array.from(new Set(matches));
}

function stripWhatsAppControlMarks(value: string): string {
  return value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

function classifyHistoricalEvent(
  content: string,
  sender: string
): { messageKind: "message" | "event"; eventType: "system" | "call" | null; content: string } {
  const cleaned = stripWhatsAppControlMarks(content).trim();
  const normalized = normalizeKey(cleaned);
  const senderPattern = escapeRegExp(normalizeKey(sender));

  const callPatterns = [
    /^(?:missed\s+)?voice call(?:,\s*.+)?$/i,
    /^(?:missed\s+)?video call(?:,\s*.+)?$/i
  ];
  if (callPatterns.some((pattern) => pattern.test(cleaned))) {
    return {
      messageKind: "event",
      eventType: "call",
      content: cleaned
    };
  }

  const systemPatterns = [
    /messages and calls are end-to-end encrypted/i,
    /security code/i,
    /turned on disappearing messages/i,
    /turned off disappearing messages/i,
    /changed (?:the )?(?:group icon|group description|group subject|subject from)/i,
    /created group/i,
    /joined using this group's invite link/i,
    /joined using the group's invite link/i,
    /changed their phone number/i,
    /this message was deleted/i
  ];
  if (systemPatterns.some((pattern) => pattern.test(cleaned))) {
    return {
      messageKind: "event",
      eventType: "system",
      content: cleaned
    };
  }

  const senderSpecificPatterns = [
    new RegExp(`^${senderPattern} is a contact\\.?$`, "i"),
    new RegExp(`^${senderPattern} added .+$`, "i"),
    new RegExp(`^${senderPattern} removed .+$`, "i"),
    new RegExp(`^${senderPattern} left\\.?$`, "i"),
    new RegExp(`^${senderPattern} created group .+$`, "i")
  ];
  if (senderSpecificPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      messageKind: "event",
      eventType: "system",
      content: cleaned
    };
  }

  return {
    messageKind: "message",
    eventType: null,
    content: cleaned
  };
}

function classifyAttachmentMedia(fileName: string, mimeType: string | null) {
  const normalizedName = fileName.toLowerCase();
  const resolvedMime = mimeType || mime.lookup(fileName) || null;
  const isSticker = normalizedName.endsWith(".webp") || normalizedName.startsWith("stk-");
  if (resolvedMime?.startsWith("video/")) {
    return {
      mediaKind: "video" as const,
      isAnimated: true
    };
  }
  if (isSticker) {
    return {
      mediaKind: "sticker" as const,
      isAnimated: normalizedName.endsWith(".webp")
    };
  }
  if (resolvedMime?.startsWith("image/")) {
    return {
      mediaKind: "image" as const,
      isAnimated: /(?:gif|apng|webp)$/i.test(resolvedMime) || /\.(gif|apng|webp)$/i.test(normalizedName)
    };
  }
  return {
    mediaKind: "file" as const,
    isAnimated: false
  };
}

function buildSessionCookieOptions(maxAgeMs = 1000 * 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    maxAge: maxAgeMs,
    path: "/"
  };
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof Readable) {
    const parts: Buffer[] = [];
    for await (const chunk of body) {
      parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(parts);
  }
  if (body && typeof body === "object" && "transformToByteArray" in body) {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  throw new Error("Unsupported blob response body");
}

export interface BlobStorage {
  put(key: string, content: Buffer, metadata?: Record<string, string>): Promise<BlobPointer>;
  get(pointer: BlobPointer): Promise<Buffer>;
}

class LocalBlobStorage implements BlobStorage {
  constructor(private readonly root: string) {}

  async put(key: string, content: Buffer, metadata?: Record<string, string>): Promise<BlobPointer> {
    const finalPath = path.join(this.root, key);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await writeFile(finalPath, content);
    return {
      storageDriver: "local",
      blobKey: key,
      metadata: JSON.stringify({
        ...metadata,
        relativePath: key
      })
    };
  }

  async get(pointer: BlobPointer): Promise<Buffer> {
    return readFile(path.join(this.root, pointer.blobKey));
  }
}

class S3BlobStorage implements BlobStorage {
  private readonly client: S3Client;

  constructor(private readonly config: AppConfig) {
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint || undefined,
      forcePathStyle: config.s3ForcePathStyle,
      credentials:
        config.s3AccessKeyId && config.s3SecretAccessKey
          ? {
              accessKeyId: config.s3AccessKeyId,
              secretAccessKey: config.s3SecretAccessKey
            }
          : undefined
    });
  }

  async put(key: string, content: Buffer, metadata?: Record<string, string>): Promise<BlobPointer> {
    if (!this.config.s3Bucket) {
      throw new Error("S3_BUCKET is required when BLOB_DRIVER=s3");
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: content,
        Metadata: metadata
      })
    );
    return {
      storageDriver: "s3",
      blobKey: key,
      metadata: JSON.stringify({
        ...metadata,
        bucket: this.config.s3Bucket,
        region: this.config.s3Region || ""
      })
    };
  }

  async get(pointer: BlobPointer): Promise<Buffer> {
    if (!this.config.s3Bucket) {
      throw new Error("S3_BUCKET is required when BLOB_DRIVER=s3");
    }
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: pointer.blobKey
      })
    );
    return streamToBuffer(response.Body);
  }
}

export function createBlobStorage(config: AppConfig): BlobStorage {
  if (config.blobDriver === "s3") {
    return new S3BlobStorage(config);
  }
  return new LocalBlobStorage(config.blobRoot);
}

function rowToUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: safeDate(row.created_at)
  };
}

async function fetchOne<T extends QueryResultRow>(
  db: Queryable,
  text: string,
  values: unknown[]
): Promise<T | null> {
  const result = (await db.query(text, values)) as QueryResult<T>;
  return result.rows[0] || null;
}

function extractDatePart(rawTime: string): string {
  return rawTime.match(/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/)?.[0] || "";
}

function extractTimePart(rawTime: string): string {
  return rawTime.match(/\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap][Mm])?/)?.[0] || rawTime;
}

function normalizeYear(year: number): number {
  if (year < 100) {
    return year >= 70 ? 1900 + year : 2000 + year;
  }
  return year;
}

function createDateStrict(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseLabelWithOrder(label: string, order: "DMY" | "MDY" | "YMD"): Date | null {
  const rawParts = (label || "").split(/[/-]/).map((part) => part.trim());
  if (rawParts.length !== 3) {
    return null;
  }
  const [aRaw, bRaw, cRaw] = rawParts;
  const [a, b, c] = rawParts.map((part) => Number.parseInt(part, 10));
  if ([a, b, c].some((value) => Number.isNaN(value))) {
    return null;
  }
  if (order === "YMD") {
    if (aRaw.length !== 4) {
      return null;
    }
    return createDateStrict(normalizeYear(a), b, c);
  }
  if (order === "MDY") {
    return createDateStrict(normalizeYear(c), a, b);
  }
  return createDateStrict(normalizeYear(c), b, a);
}

function scoreDateOrder(labels: string[], order: "DMY" | "MDY" | "YMD"): number {
  return labels.reduce((score, label) => {
    const parsed = parseLabelWithOrder(label, order);
    return parsed ? score + 1 : score;
  }, 0);
}

function inferDateOrder(dateLabels: string[]): "DMY" | "MDY" | "YMD" {
  const filtered = dateLabels.filter(Boolean);
  const scores = {
    DMY: scoreDateOrder(filtered, "DMY"),
    MDY: scoreDateOrder(filtered, "MDY"),
    YMD: scoreDateOrder(filtered, "YMD")
  };
  if (scores.YMD > scores.DMY && scores.YMD > scores.MDY) {
    return "YMD";
  }
  if (scores.MDY > scores.DMY) {
    return "MDY";
  }
  return "DMY";
}

function parseExportTimestamp(rawLabel: string, order: "DMY" | "MDY" | "YMD"): string | null {
  const datePart = extractDatePart(rawLabel);
  const timePart = extractTimePart(rawLabel);
  const baseDate = parseLabelWithOrder(datePart, order);
  if (!baseDate) {
    return null;
  }
  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?$/);
  if (!timeMatch) {
    return baseDate.toISOString();
  }
  let [, hourRaw, minuteRaw, secondRaw, meridian] = timeMatch;
  let hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  const second = Number.parseInt(secondRaw || "0", 10);
  if (meridian) {
    const upper = meridian.toUpperCase();
    if (upper === "PM" && hour < 12) {
      hour += 12;
    }
    if (upper === "AM" && hour === 12) {
      hour = 0;
    }
  }
  baseDate.setUTCHours(hour, minute, second, 0);
  return baseDate.toISOString();
}

function extractAttachmentCandidates(content: string): string[] {
  const matches = new Set<string>();
  const genericPattern =
    /([A-Za-z0-9][A-Za-z0-9 _().-]{0,180}\.(?:jpg|jpeg|png|gif|webp|heic|mp4|mov|pdf|opus|ogg|aac|m4a|mp3|doc|docx|xls|xlsx|ppt|pptx|vcf|txt|zip))/gi;
  for (const match of content.matchAll(genericPattern)) {
    if (match[1]) {
      matches.add(path.basename(match[1].trim()));
    }
  }
  for (const match of content.matchAll(/<attached:\s*([^>]+)>/gi)) {
    if (match[1]) {
      matches.add(path.basename(match[1].trim()));
    }
  }
  return Array.from(matches);
}

export async function parseWhatsAppArchive(
  fileName: string,
  input: Buffer,
  selfDisplayName?: string
): Promise<ParsedArchive> {
  let transcriptText = "";
  let transcriptName = path.basename(fileName);
  let chatTitle = deriveChatTitle(fileName);
  const attachmentMap = new Map<string, AttachmentRecord>();
  const lowerName = fileName.toLowerCase();
  let withMedia = false;

  if (lowerName.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(input);
    const transcriptEntry = Object.values(zip.files).find(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".txt") && !entry.name.startsWith("__MACOSX")
    );
    if (!transcriptEntry) {
      throw new Error("ZIP export does not include a WhatsApp transcript .txt");
    }
    transcriptName = path.basename(transcriptEntry.name);
    chatTitle = deriveChatTitle(transcriptEntry.name) || deriveChatTitle(fileName);
    transcriptText = await transcriptEntry.async("string");

    const attachmentEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name !== transcriptEntry.name && !entry.name.startsWith("__MACOSX")
    );
    withMedia = attachmentEntries.length > 0;
    for (const entry of attachmentEntries) {
      const data = await entry.async("nodebuffer");
      const baseName = path.basename(entry.name);
      attachmentMap.set(normalizeKey(baseName), {
        fileName: baseName,
        normalizedName: normalizeKey(baseName),
        archivePath: entry.name,
        buffer: data,
        contentSha256: sha256Hex(data),
        byteSize: data.byteLength,
        mimeType: mime.lookup(baseName) || "application/octet-stream",
        placeholderText: null
      });
    }
  } else {
    transcriptText = input.toString("utf8");
  }

  const regex =
    /^\[?(\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s(?:-\s)?([^:]+):\s(.*)$/;
  const lines = transcriptText.split(/\r?\n/);
  const rawMessages: Array<{
    rawTimestampLabel: string;
    sender: string;
    content: string;
  }> = [];
  let lastMessage: (typeof rawMessages)[number] | null = null;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const [, rawTimestampLabel, sender, content] = match;
      const message = {
        rawTimestampLabel: rawTimestampLabel.trim(),
        sender: sender.trim(),
        content: content || ""
      };
      rawMessages.push(message);
      lastMessage = message;
      continue;
    }
    if (lastMessage) {
      lastMessage.content += `\n${line}`;
    }
  }

  const inferredOrder = inferDateOrder(rawMessages.map((message) => extractDatePart(message.rawTimestampLabel)));
  const messages = rawMessages.map<ParsedMessage>((message) => {
    const attachmentCandidates = extractAttachmentCandidates(message.content)
      .map((candidate) => attachmentMap.get(normalizeKey(candidate)))
      .filter((candidate): candidate is AttachmentRecord => Boolean(candidate))
      .map((candidate) => ({
        ...candidate,
        placeholderText: candidate.fileName
      }));
    const content = message.content.replace(/^<media omitted>$/i, "[Media omitted]");
    const classification = classifyHistoricalEvent(content, message.sender);
    return {
      sender: message.sender,
      normalizedSender: normalizeKey(message.sender),
      rawTimestampLabel: message.rawTimestampLabel,
      timestampIso: parseExportTimestamp(message.rawTimestampLabel, inferredOrder),
      content: classification.content,
      isMe: selfDisplayName
        ? normalizeKey(message.sender) === normalizeKey(selfDisplayName)
        : normalizeKey(message.sender) === "you",
      messageKind: classification.messageKind,
      eventType: classification.eventType,
      attachments: attachmentCandidates
    };
  });

  return {
    chatTitle: chatTitle || "Untitled chat",
    normalizedChatTitle: normalizeKey(chatTitle || "Untitled chat"),
    transcriptName,
    withMedia,
    messages
  };
}

export class ArchiveServices {
  private workerInterval: NodeJS.Timeout | null = null;
  private workerBusy = false;

  constructor(private readonly options: ArchiveServicesOptions) {}

  async registerUser(username: string, password: string): Promise<AuthResult> {
    const normalizedUsername = normalizeKey(username);
    validateCredentials(normalizedUsername, password);
    const existing = await fetchOne<UserRow>(
      this.options.db,
      "SELECT * FROM users WHERE username = $1",
      [normalizedUsername]
    );
    if (existing) {
      throw new Error("Username is already taken");
    }
    const id = randomUUID();
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id
    });
    const row = await fetchOne<UserRow>(
      this.options.db,
      "INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING *",
      [id, normalizedUsername, passwordHash]
    );
    if (!row) {
      throw new Error("Failed to create user");
    }
    const sessionToken = await this.createSession(row.id);
    return {
      user: rowToUser(row),
      sessionToken
    };
  }

  async loginUser(username: string, password: string): Promise<AuthResult> {
    const normalizedUsername = normalizeKey(username);
    const row = await fetchOne<UserRow>(
      this.options.db,
      "SELECT * FROM users WHERE username = $1",
      [normalizedUsername]
    );
    if (!row) {
      throw new Error("Invalid username or password");
    }
    const verified = await argon2.verify(row.password_hash, password);
    if (!verified) {
      throw new Error("Invalid username or password");
    }
    const sessionToken = await this.createSession(row.id);
    return {
      user: rowToUser(row),
      sessionToken
    };
  }

  async getUserBySessionToken(token: string): Promise<SafeUser | null> {
    const tokenHash = hmacHex(this.options.config.sessionSecret, token);
    const row = await fetchOne<UserRow & SessionRow>(
      this.options.db,
      `SELECT u.*, s.id AS session_id, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [tokenHash]
    );
    if (!row) {
      return null;
    }
    const expiresAt = new Date((row as SessionRow).expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await this.options.db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
      return null;
    }
    await this.options.db.query(
      "UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = $1",
      [tokenHash]
    );
    return rowToUser(row);
  }

  async logoutSession(token: string): Promise<void> {
    const tokenHash = hmacHex(this.options.config.sessionSecret, token);
    await this.options.db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async getUserSettings(ownerId: string): Promise<UserSettings> {
    const row = await fetchOne<UserRow>(
      this.options.db,
      "SELECT * FROM users WHERE id = $1",
      [ownerId]
    );
    if (!row) {
      throw new Error("User not found");
    }
    return {
      selfDisplayName: row.self_display_name || ""
    };
  }

  async updateUserSettings(ownerId: string, settings: UserSettings): Promise<UserSettings> {
    const row = await fetchOne<UserRow>(
      this.options.db,
      `UPDATE users
       SET self_display_name = $2
       WHERE id = $1
       RETURNING *`,
      [ownerId, settings.selfDisplayName.trim() || null]
    );
    if (!row) {
      throw new Error("User not found");
    }
    return {
      selfDisplayName: row.self_display_name || ""
    };
  }

  async createImport(
    ownerId: string,
    fileName: string,
    content: Buffer,
    options: CreateImportOptions = {}
  ) {
    const fileSha256 = sha256Hex(content);
    const existing = await fetchOne<ImportRow>(
      this.options.db,
      "SELECT * FROM imports WHERE owner_id = $1 AND file_sha256 = $2",
      [ownerId, fileSha256]
    );
    if (existing) {
      const error = new Error("This export has already been imported");
      (error as Error & { existingImportId?: string }).existingImportId = existing.id;
      throw error;
    }

    const id = randomUUID();
    const sourceBlob = await this.options.storage.put(
      `imports/${ownerId}/${id}.bin`,
      encryptBytes(content, this.options.config.encryptionKey),
      {
        kind: "source",
        fileName: path.basename(fileName)
      }
    );
    const sourceChatTitle = deriveChatTitle(fileName) || "Untitled chat";
    const row = await fetchOne<ImportRow>(
      this.options.db,
      `INSERT INTO imports (
        id, owner_id, status, file_name, file_sha256, source_blob_key, source_blob_storage,
        source_blob_metadata, source_size, source_chat_title, normalized_chat_title, import_options
      )
      VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id,
        ownerId,
        fileName,
        fileSha256,
        sourceBlob.blobKey,
        sourceBlob.storageDriver,
        sourceBlob.metadata,
        content.byteLength,
        sourceChatTitle,
        normalizeKey(sourceChatTitle),
        JSON.stringify({
          selfDisplayName: options.selfDisplayName?.trim() || ""
        })
      ]
    );
    if (!row) {
      throw new Error("Failed to create import");
    }
    this.kickWorker();
    return this.serializeImport(row);
  }

  async createImportFromFile(
    ownerId: string,
    fileName: string,
    filePath: string,
    options: CreateImportOptions = {}
  ) {
    const { sha256: fileSha256, size } = await hashFileSha256(filePath);
    const existing = await fetchOne<ImportRow>(
      this.options.db,
      "SELECT * FROM imports WHERE owner_id = $1 AND file_sha256 = $2",
      [ownerId, fileSha256]
    );
    if (existing) {
      const error = new Error("This export has already been imported");
      (error as Error & { existingImportId?: string }).existingImportId = existing.id;
      throw error;
    }

    const content = await readFile(filePath);
    const id = randomUUID();
    const sourceBlob = await this.options.storage.put(
      `imports/${ownerId}/${id}.bin`,
      encryptBytes(content, this.options.config.encryptionKey),
      {
        kind: "source",
        fileName: path.basename(fileName)
      }
    );
    const sourceChatTitle = deriveChatTitle(fileName) || "Untitled chat";
    const row = await fetchOne<ImportRow>(
      this.options.db,
      `INSERT INTO imports (
        id, owner_id, status, file_name, file_sha256, source_blob_key, source_blob_storage,
        source_blob_metadata, source_size, source_chat_title, normalized_chat_title, import_options
      )
      VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id,
        ownerId,
        fileName,
        fileSha256,
        sourceBlob.blobKey,
        sourceBlob.storageDriver,
        sourceBlob.metadata,
        size,
        sourceChatTitle,
        normalizeKey(sourceChatTitle),
        JSON.stringify({
          selfDisplayName: options.selfDisplayName?.trim() || ""
        })
      ]
    );
    if (!row) {
      throw new Error("Failed to create import");
    }
    this.kickWorker();
    return this.serializeImport(row);
  }

  async listImports(ownerId: string) {
    const result = await this.options.db.query<ImportRow>(
      "SELECT * FROM imports WHERE owner_id = $1 ORDER BY created_at DESC",
      [ownerId]
    );
    return result.rows.map((row) => this.serializeImport(row));
  }

  async getImport(ownerId: string, importId: string) {
    const row = await fetchOne<ImportRow>(
      this.options.db,
      "SELECT * FROM imports WHERE owner_id = $1 AND id = $2",
      [ownerId, importId]
    );
    return row ? this.serializeImport(row) : null;
  }

  async listChats(ownerId: string) {
    const result = await this.options.db.query<ChatRow>(
      "SELECT * FROM chats WHERE owner_id = $1 ORDER BY updated_at DESC",
      [ownerId]
    );
    return Promise.all(
      result.rows.map(async (row) => {
        const [messageCountRow, attachmentCountRow, lastMessageRow] = await Promise.all([
          fetchOne<QueryResultRow>(
            this.options.db,
            "SELECT COUNT(*)::int AS total FROM messages WHERE chat_id = $1",
            [row.id]
          ),
          fetchOne<QueryResultRow>(
            this.options.db,
            "SELECT COUNT(*)::int AS total FROM attachments WHERE chat_id = $1",
            [row.id]
          ),
          fetchOne<QueryResultRow>(
            this.options.db,
            "SELECT MAX(message_timestamp) AS last_message_at FROM messages WHERE chat_id = $1",
            [row.id]
          )
        ]);
        return {
          id: row.id,
          title: row.display_title,
          displayTitle: row.display_title,
          sourceTitle: row.source_title,
          titleOverridden: row.title_overridden,
          normalizedTitle: row.normalized_title,
          messageCount: Number(messageCountRow?.total || 0),
          attachmentCount: Number(attachmentCountRow?.total || 0),
          lastMessageAt: toIso((lastMessageRow?.last_message_at as Date | string | null) || null),
          updatedAt: safeDate(row.updated_at)
        };
      })
    );
  }

  async getChat(ownerId: string, chatId: string) {
    const row = await fetchOne<ChatRow>(
      this.options.db,
      "SELECT * FROM chats WHERE owner_id = $1 AND id = $2",
      [ownerId, chatId]
    );
    if (!row) {
      return null;
    }
    const stats = await this.getChatStats(ownerId, chatId);
    return {
      id: row.id,
      title: row.display_title,
      displayTitle: row.display_title,
      sourceTitle: row.source_title,
      titleOverridden: row.title_overridden,
      normalizedTitle: row.normalized_title,
      createdAt: safeDate(row.created_at),
      updatedAt: safeDate(row.updated_at),
      stats
    };
  }

  async getChatMessages(ownerId: string, chatId: string) {
    const messagesResult = await this.options.db.query<MessageRow>(
      `SELECT *
       FROM messages
       WHERE owner_id = $1 AND chat_id = $2
       ORDER BY COALESCE(message_timestamp, created_at), created_at`,
      [ownerId, chatId]
    );
    const messageIds = messagesResult.rows.map((row: MessageRow) => row.id);
    const attachmentsByMessageId = await this.loadAttachmentsByMessageIds(ownerId, messageIds);
    return messagesResult.rows.map((row: MessageRow) => ({
      id: row.id,
      chatId: row.chat_id,
      sender: row.sender_name,
      normalizedSender: row.normalized_sender_name,
      timestamp: toIso(row.message_timestamp),
      rawTimestampLabel: row.original_timestamp_label,
      body: decryptText(row.body_encrypted, this.options.config.encryptionKey),
      isMe: row.is_me,
      messageKind: row.message_kind,
      eventType: row.event_type,
      hasAttachments: row.has_attachments,
      attachments: attachmentsByMessageId.get(row.id) || []
    }));
  }

  async searchChat(ownerId: string, chatId: string, query: string) {
    return this.searchMessages(ownerId, query, chatId);
  }

  async searchAllChats(ownerId: string, query: string) {
    const results = await this.searchMessages(ownerId, query);
    const chatRows = await this.options.db.query<ChatRow>(
      "SELECT * FROM chats WHERE owner_id = $1",
      [ownerId]
    );
    const chatsById = new Map(
      chatRows.rows.map((row) => [
        row.id,
        {
          chatTitle: row.display_title,
          sourceTitle: row.source_title
        }
      ])
    );
    return results.map((result) => ({
      ...result,
      chatTitle: chatsById.get(result.chatId)?.chatTitle || "Unknown chat",
      sourceTitle: chatsById.get(result.chatId)?.sourceTitle || "Unknown chat"
    }));
  }

  async updateChatTitle(ownerId: string, chatId: string, displayTitle: string) {
    const row = await fetchOne<ChatRow>(
      this.options.db,
      `UPDATE chats
       SET display_title = CASE
             WHEN $3 = '' THEN source_title
             ELSE $3
           END,
           title_overridden = CASE
             WHEN $3 = '' THEN FALSE
             ELSE TRUE
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE owner_id = $1 AND id = $2
       RETURNING *`,
      [ownerId, chatId, displayTitle.trim()]
    );
    if (!row) {
      return null;
    }
    const stats = await this.getChatStats(ownerId, chatId);
    return {
      id: row.id,
      title: row.display_title,
      displayTitle: row.display_title,
      sourceTitle: row.source_title,
      titleOverridden: row.title_overridden,
      normalizedTitle: row.normalized_title,
      createdAt: safeDate(row.created_at),
      updatedAt: safeDate(row.updated_at),
      stats
    };
  }

  async getChatStats(ownerId: string, chatId: string) {
    const totals = await fetchOne<QueryResultRow>(
      this.options.db,
      `SELECT
        COUNT(*)::int AS message_count,
        SUM(CASE WHEN has_attachments THEN 1 ELSE 0 END)::int AS attachment_message_count
       FROM messages
       WHERE owner_id = $1 AND chat_id = $2`,
      [ownerId, chatId]
    );
    const senders = await this.options.db.query<SenderStatsRow>(
      `SELECT sender_name, COUNT(*)::int AS total
       FROM messages
       WHERE owner_id = $1 AND chat_id = $2 AND message_kind = 'message'
       GROUP BY sender_name
       ORDER BY total DESC, sender_name ASC`,
      [ownerId, chatId]
    );
    return {
      messageCount: Number(totals?.message_count || 0),
      attachmentMessageCount: Number(totals?.attachment_message_count || 0),
      senders: senders.rows.map((row: SenderStatsRow) => ({
        sender: String(row.sender_name),
        total: Number(row.total)
      }))
    };
  }

  async getAttachmentForUser(ownerId: string, attachmentId: string) {
    const row = await fetchOne<AttachmentRow>(
      this.options.db,
      "SELECT * FROM attachments WHERE owner_id = $1 AND id = $2",
      [ownerId, attachmentId]
    );
    if (!row || !row.blob_key || !row.storage_driver) {
      return null;
    }
    const encrypted = await this.options.storage.get({
      storageDriver: row.storage_driver,
      blobKey: row.blob_key,
      metadata: row.blob_metadata
    });
    const content = decryptBytes(encrypted, this.options.config.encryptionKey);
    return {
      fileName: row.file_name,
      mimeType: row.mime_type || "application/octet-stream",
      byteSize: Number(row.byte_size),
      content
    };
  }

  startWorker(intervalMs = 2000): void {
    if (this.workerInterval) {
      return;
    }
    this.workerInterval = setInterval(() => {
      void this.processPendingImports();
    }, intervalMs);
    this.kickWorker();
  }

  stopWorker(): void {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }

  async processPendingImports(limit = 10): Promise<void> {
    if (this.workerBusy) {
      return;
    }
    this.workerBusy = true;
    try {
      for (let index = 0; index < limit; index += 1) {
        const nextImport = await fetchOne<ImportRow>(
          this.options.db,
          `UPDATE imports
           SET status = 'processing', updated_at = CURRENT_TIMESTAMP
           WHERE id = (
             SELECT id
             FROM imports
             WHERE status = 'pending'
             ORDER BY created_at ASC
             LIMIT 1
           )
           RETURNING *`,
          []
        );
        if (!nextImport) {
          break;
        }
        try {
          await this.processImport(nextImport);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown import error";
          await this.options.db.query(
            `UPDATE imports
             SET status = 'failed', error_message = $2, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [nextImport.id, message]
          );
          this.options.logger.error({ err: error, importId: nextImport.id }, "Failed to process import");
        }
      }
    } finally {
      this.workerBusy = false;
    }
  }

  private kickWorker(): void {
    setTimeout(() => {
      void this.processPendingImports();
    }, 0);
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hmacHex(this.options.config.sessionSecret, token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    await this.options.db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, tokenHash, expiresAt]
    );
    return token;
  }

  private async processImport(importRow: ImportRow): Promise<void> {
    const encryptedSource = await this.options.storage.get({
      storageDriver: importRow.source_blob_storage,
      blobKey: importRow.source_blob_key,
      metadata: importRow.source_blob_metadata
    });
    const sourceBuffer = decryptBytes(encryptedSource, this.options.config.encryptionKey);
    const importOptions = parseJson<{ selfDisplayName?: string }>(importRow.import_options, {});
    const parsedArchive = await parseWhatsAppArchive(
      importRow.file_name,
      sourceBuffer,
      importOptions.selfDisplayName
    );

    const client = await this.options.db.connect();
    try {
      await client.query("BEGIN");
      const chat = await this.upsertChat(client, importRow.owner_id, parsedArchive.chatTitle, parsedArchive.normalizedChatTitle, importRow.id);
      const participantCache = new Map<string, ParticipantRow>();
      let messagesInserted = 0;
      let attachmentsLinked = 0;
      let attachmentsStored = 0;

      for (const parsedMessage of parsedArchive.messages) {
        let participant: ParticipantRow | null = null;
        if (parsedMessage.normalizedSender) {
          participant = await this.upsertParticipant(
            client,
            importRow.owner_id,
            chat.id,
            parsedMessage.sender,
            parsedMessage.normalizedSender,
            participantCache
          );
        }

        const messageFingerprint = buildMessageFingerprint(parsedMessage);
        const insertedMessage = await fetchOne<MessageRow>(
          client,
          `INSERT INTO messages (
            id, owner_id, chat_id, import_id, sender_participant_id, sender_name, normalized_sender_name,
            message_timestamp, original_timestamp_label, body_encrypted, is_me, has_attachments,
            message_kind, event_type, message_fingerprint
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (chat_id, message_fingerprint) DO NOTHING
          RETURNING *`,
          [
            randomUUID(),
            importRow.owner_id,
            chat.id,
            importRow.id,
            participant?.id || null,
            parsedMessage.sender,
            parsedMessage.normalizedSender,
            parsedMessage.timestampIso,
            parsedMessage.rawTimestampLabel,
            encryptText(parsedMessage.content, this.options.config.encryptionKey),
            parsedMessage.isMe,
            parsedMessage.attachments.length > 0,
            parsedMessage.messageKind,
            parsedMessage.eventType,
            messageFingerprint
          ]
        );

        const message =
          insertedMessage ||
          (await fetchOne<MessageRow>(
            client,
            "SELECT * FROM messages WHERE chat_id = $1 AND message_fingerprint = $2",
            [chat.id, messageFingerprint]
          ));
        if (!message) {
          throw new Error("Unable to locate message after upsert");
        }
        if (insertedMessage) {
          messagesInserted += 1;
          const searchTokens = tokeniseForSearch(parsedMessage.content);
          for (const token of searchTokens) {
            await client.query(
              `INSERT INTO message_search_tokens (message_id, owner_id, chat_id, token_hash)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING`,
              [message.id, importRow.owner_id, chat.id, hmacHex(this.options.config.sessionSecret, token)]
            );
          }
        }

        for (const attachment of parsedMessage.attachments) {
          const savedAttachment = await this.materialiseAttachment(importRow.owner_id, chat.id, message.id, attachment);
          await client.query(
            `INSERT INTO attachments (
              id, owner_id, chat_id, message_id, file_name, normalized_name, mime_type, byte_size,
              content_sha256, storage_driver, blob_key, blob_metadata, placeholder_text, attachment_fingerprint
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (message_id, attachment_fingerprint) DO NOTHING`,
            [
              randomUUID(),
              importRow.owner_id,
              chat.id,
              message.id,
              savedAttachment.fileName,
              savedAttachment.normalizedName,
              savedAttachment.mimeType,
              savedAttachment.byteSize,
              savedAttachment.contentSha256 || null,
              savedAttachment.storageDriver || null,
              savedAttachment.blobKey || null,
              savedAttachment.blobMetadata || "{}",
              savedAttachment.placeholderText || null,
              savedAttachment.attachmentFingerprint
            ]
          );
          attachmentsLinked += 1;
          if (savedAttachment.didStoreBlob) {
            attachmentsStored += 1;
          }
        }
      }

      await client.query(
      `UPDATE chats
         SET updated_at = CURRENT_TIMESTAMP, last_import_id = $2
         WHERE id = $1`,
        [chat.id, importRow.id]
      );
      await client.query(
        `UPDATE imports
         SET status = 'completed',
             source_chat_title = $2,
             normalized_chat_title = $3,
             parse_summary = $4,
             error_message = NULL,
             updated_at = CURRENT_TIMESTAMP,
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          importRow.id,
          parsedArchive.chatTitle,
          parsedArchive.normalizedChatTitle,
          JSON.stringify({
            transcriptName: parsedArchive.transcriptName,
            messagesParsed: parsedArchive.messages.length,
            messagesInserted,
            attachmentsLinked,
            attachmentsStored,
            participants: participantCache.size,
            withMedia: parsedArchive.withMedia
          } satisfies ImportSummary)
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertChat(
    db: Queryable,
    ownerId: string,
    sourceTitle: string,
    normalizedTitle: string,
    importId: string
  ): Promise<ChatRow> {
    const inserted = await fetchOne<ChatRow>(
      db,
      `INSERT INTO chats (id, owner_id, source_title, display_title, normalized_title, last_import_id)
       VALUES ($1, $2, $3, $3, $4, $5)
       ON CONFLICT (owner_id, normalized_title)
       DO UPDATE SET
         source_title = EXCLUDED.source_title,
         display_title = CASE
           WHEN chats.title_overridden THEN chats.display_title
           ELSE EXCLUDED.source_title
         END,
         last_import_id = EXCLUDED.last_import_id,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [randomUUID(), ownerId, sourceTitle, normalizedTitle, importId]
    );
    if (!inserted) {
      throw new Error("Unable to upsert chat");
    }
    return inserted;
  }

  private async upsertParticipant(
    db: Queryable,
    ownerId: string,
    chatId: string,
    displayName: string,
    normalizedName: string,
    cache: Map<string, ParticipantRow>
  ): Promise<ParticipantRow> {
    const cached = cache.get(normalizedName);
    if (cached) {
      return cached;
    }
    const row = await fetchOne<ParticipantRow>(
      db,
      `INSERT INTO participants (id, owner_id, chat_id, display_name, normalized_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chat_id, normalized_name)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING *`,
      [randomUUID(), ownerId, chatId, displayName, normalizedName]
    );
    if (!row) {
      throw new Error("Unable to upsert participant");
    }
    cache.set(normalizedName, row);
    return row;
  }

  private async materialiseAttachment(
    ownerId: string,
    chatId: string,
    messageId: string,
    attachment: AttachmentRecord
  ) {
    const attachmentFingerprint = buildAttachmentFingerprint(attachment);
    if (!attachment.buffer || !attachment.contentSha256) {
      return {
        fileName: attachment.fileName,
        normalizedName: attachment.normalizedName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        contentSha256: null,
        storageDriver: null,
        blobKey: null,
        blobMetadata: "{}",
        placeholderText: attachment.placeholderText || attachment.fileName,
        attachmentFingerprint,
        didStoreBlob: false
      };
    }

    const existing = await fetchOne<AttachmentRow>(
      this.options.db,
      `SELECT *
       FROM attachments
       WHERE owner_id = $1 AND content_sha256 = $2 AND blob_key IS NOT NULL
       LIMIT 1`,
      [ownerId, attachment.contentSha256]
    );
    if (existing) {
      return {
        fileName: attachment.fileName,
        normalizedName: attachment.normalizedName,
        mimeType: existing.mime_type || attachment.mimeType,
        byteSize: attachment.byteSize,
        contentSha256: attachment.contentSha256,
        storageDriver: existing.storage_driver,
        blobKey: existing.blob_key,
        blobMetadata: existing.blob_metadata,
        placeholderText: attachment.placeholderText || attachment.fileName,
        attachmentFingerprint,
        didStoreBlob: false
      };
    }

    const pointer = await this.options.storage.put(
      `attachments/${ownerId}/${chatId}/${messageId}-${attachment.contentSha256}`,
      encryptBytes(attachment.buffer, this.options.config.encryptionKey),
      {
        kind: "attachment",
        fileName: attachment.fileName
      }
    );
    return {
      fileName: attachment.fileName,
      normalizedName: attachment.normalizedName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      contentSha256: attachment.contentSha256,
      storageDriver: pointer.storageDriver,
      blobKey: pointer.blobKey,
      blobMetadata: pointer.metadata,
      placeholderText: attachment.placeholderText || attachment.fileName,
      attachmentFingerprint,
      didStoreBlob: true
    };
  }

  private async searchMessages(ownerId: string, query: string, chatId?: string) {
    const tokens = tokeniseForSearch(query);
    if (tokens.length === 0) {
      return [];
    }
    const tokenHashes = tokens.map((token) => hmacHex(this.options.config.sessionSecret, token));
    const tokenRows = await this.options.db.query<
      QueryResultRow & { message_id: string; token_hash: string; created_at: Date | string }
    >(
      `SELECT mst.message_id, mst.token_hash, mst.created_at
       FROM message_search_tokens mst
       WHERE mst.owner_id = $1
         ${chatId ? "AND mst.chat_id = $2" : ""}
       ORDER BY mst.created_at DESC`,
      chatId ? [ownerId, chatId] : [ownerId]
    );
    const requiredHashes = new Set(tokenHashes);
    const matchedMessageIds = new Set<string>();
    const seenHashesByMessage = new Map<string, Set<string>>();
    for (const row of tokenRows.rows) {
      if (!requiredHashes.has(row.token_hash)) {
        continue;
      }
      const seenHashes = seenHashesByMessage.get(row.message_id) || new Set<string>();
      seenHashes.add(row.token_hash);
      seenHashesByMessage.set(row.message_id, seenHashes);
      if (seenHashes.size === requiredHashes.size) {
        matchedMessageIds.add(row.message_id);
      }
      if (matchedMessageIds.size >= 200) {
        break;
      }
    }
    if (matchedMessageIds.size === 0) {
      return [];
    }
    const result = await this.options.db.query<MessageRow>(
      `SELECT m.*
       FROM messages m
       WHERE m.owner_id = $1
         ${chatId ? "AND m.chat_id = $2" : ""}
       ORDER BY COALESCE(m.message_timestamp, m.created_at) DESC, m.created_at DESC`,
      chatId ? [ownerId, chatId] : [ownerId]
    );
    const filteredRows = result.rows.filter((row) => matchedMessageIds.has(row.id)).slice(0, 200);
    const attachmentsByMessageId = await this.loadAttachmentsByMessageIds(
      ownerId,
      filteredRows.map((row) => row.id)
    );
    return filteredRows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      sender: row.sender_name,
      normalizedSender: row.normalized_sender_name,
      timestamp: toIso(row.message_timestamp),
      rawTimestampLabel: row.original_timestamp_label,
      body: decryptText(row.body_encrypted, this.options.config.encryptionKey),
      isMe: row.is_me,
      messageKind: row.message_kind,
      eventType: row.event_type,
      hasAttachments: row.has_attachments,
      attachments: attachmentsByMessageId.get(row.id) || []
    }));
  }

  private async loadAttachmentsByMessageIds(ownerId: string, messageIds: string[]) {
    const byMessage = new Map<string, Array<{
      id: string;
      fileName: string;
      mimeType: string | null;
      byteSize: number;
      hasBlob: boolean;
      placeholderText: string | null;
      mediaKind: "image" | "video" | "sticker" | "file";
      isAnimated: boolean;
      previewUrl: string | null;
      contentUrl: string | null;
    }>>();
    if (messageIds.length === 0) {
      return byMessage;
    }
    const result = await this.options.db.query<AttachmentRow>(
      `SELECT *
       FROM attachments
       WHERE owner_id = $1 AND message_id = ANY($2::text[])
       ORDER BY created_at`,
      [ownerId, messageIds]
    );
    for (const row of result.rows as AttachmentRow[]) {
      const list = byMessage.get(row.message_id) || [];
      const media = classifyAttachmentMedia(row.file_name, row.mime_type);
      const contentUrl = row.blob_key ? `/api/attachments/${row.id}` : null;
      list.push({
        id: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        hasBlob: Boolean(row.blob_key),
        placeholderText: row.placeholder_text
          ? stripWhatsAppControlMarks(row.placeholder_text)
          : null,
        mediaKind: media.mediaKind,
        isAnimated: media.isAnimated,
        previewUrl: contentUrl,
        contentUrl
      });
      byMessage.set(row.message_id, list);
    }
    return byMessage;
  }

  private serializeImport(row: ImportRow) {
    return {
      id: row.id,
      fileName: row.file_name,
      chatTitle: row.source_chat_title,
      normalizedChatTitle: row.normalized_chat_title,
      status: row.status,
      sourceSize: Number(row.source_size),
      createdAt: safeDate(row.created_at),
      updatedAt: safeDate(row.updated_at),
      completedAt: toIso(row.completed_at),
      parseSummary: parseJson<ImportSummary | ParsedJsonObject>(row.parse_summary, {}),
      errorMessage: row.error_message
    };
  }
}

export function validateCredentials(username: string, password: string): void {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("Username must be 3-32 chars and use lowercase letters, numbers, ., _, or -");
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error("Password must be between 8 and 128 characters");
  }
}

export const sessionCookieName = "ownwa_session";
export const sessionCookieOptions = buildSessionCookieOptions();
