import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export type BlobDriverKind = "local" | "s3";

export interface AppConfig {
  databaseUrl: string;
  port: number;
  sessionSecret: string;
  appOrigin: string;
  encryptionKey: Buffer;
  maxImportBytes: number;
  uploadTmpDir: string;
  importWorkerIntervalMs: number;
  importWorkerBatchSize: number;
  largeImportThresholdBytes: number;
  importProgressStepPercent: number;
  blobDriver: BlobDriverKind;
  blobRoot: string;
  s3Region?: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;
}

export const DEFAULT_LARGE_IMPORT_THRESHOLD_BYTES = 2 * 1024 ** 3;
export const DEFAULT_IMPORT_WORKER_INTERVAL_MS = 2000;
export const DEFAULT_IMPORT_WORKER_BATCH_SIZE = 10;
export const DEFAULT_IMPORT_PROGRESS_STEP_PERCENT = 5;

export function clampPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
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

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const sessionSecret = env.SESSION_SECRET?.trim() || "development-session-secret";
  const rawKey =
    env.ARCHIVE_ENCRYPTION_KEY?.trim() ||
    Buffer.from("development-encryption-key-12345").toString("base64");
  const encryptionKey = parseEncryptionKey(rawKey);
  const maxImportBytes = clampPositiveInteger(Number(env.MAX_IMPORT_BYTES || 10737418240), 10737418240);
  const importWorkerIntervalMs = clampPositiveInteger(
    Number(env.IMPORT_WORKER_INTERVAL_MS || DEFAULT_IMPORT_WORKER_INTERVAL_MS),
    DEFAULT_IMPORT_WORKER_INTERVAL_MS
  );
  const importWorkerBatchSize = clampPositiveInteger(
    Number(env.IMPORT_WORKER_BATCH_SIZE || DEFAULT_IMPORT_WORKER_BATCH_SIZE),
    DEFAULT_IMPORT_WORKER_BATCH_SIZE
  );
  const largeImportThresholdBytes = clampPositiveInteger(
    Number(env.LARGE_IMPORT_THRESHOLD_BYTES || DEFAULT_LARGE_IMPORT_THRESHOLD_BYTES),
    DEFAULT_LARGE_IMPORT_THRESHOLD_BYTES
  );
  const importProgressStepPercent = clampPositiveInteger(
    Number(env.IMPORT_PROGRESS_STEP_PERCENT || DEFAULT_IMPORT_PROGRESS_STEP_PERCENT),
    DEFAULT_IMPORT_PROGRESS_STEP_PERCENT
  );

  return {
    databaseUrl: env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ownwa",
    port: Number(env.PORT || 4000),
    sessionSecret,
    appOrigin: env.APP_ORIGIN || "http://localhost:5173",
    encryptionKey,
    maxImportBytes,
    uploadTmpDir: env.UPLOAD_TMP_DIR ? path.resolve(env.UPLOAD_TMP_DIR) : path.resolve(process.cwd(), "tmp/uploads"),
    importWorkerIntervalMs,
    importWorkerBatchSize,
    largeImportThresholdBytes,
    importProgressStepPercent,
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

function buildSessionCookieOptions(maxAgeMs = 1000 * 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    maxAge: maxAgeMs,
    path: "/"
  };
}

export const sessionCookieName = "ownwa_session";
export const sessionCookieOptions = buildSessionCookieOptions();
