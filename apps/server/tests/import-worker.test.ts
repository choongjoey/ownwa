import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import pino from "pino";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { ArchiveServices, runMigrations, type AppConfig, type BlobPointer, type BlobStorage } from "../src/lib.js";

async function buildZipExport(chatTitle: string, transcriptLines: string[], attachments?: Record<string, Buffer>) {
  const zip = new JSZip();
  zip.file(`WhatsApp Chat with ${chatTitle}.txt`, transcriptLines.join("\n"));
  for (const [fileName, buffer] of Object.entries(attachments || {})) {
    zip.file(fileName, buffer);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function encryptForLargeImportSource(content: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, encrypted, tag]);
}

class StubBlobStorage implements BlobStorage {
  readonly stored = new Map<string, Buffer>();
  putCalls = 0;
  putFileCalls = 0;
  getCalls = 0;
  getToFileCalls = 0;
  deleteCalls = 0;

  constructor(private readonly encryptedImportSource: Buffer) {}

  async put(key: string, content: Buffer, metadata?: Record<string, string>): Promise<BlobPointer> {
    this.putCalls += 1;
    this.stored.set(key, content);
    return {
      storageDriver: "local",
      blobKey: key,
      metadata: JSON.stringify(metadata || {})
    };
  }

  async get(pointer: BlobPointer): Promise<Buffer> {
    this.getCalls += 1;
    const content = this.stored.get(pointer.blobKey);
    if (!content) {
      throw new Error(`Unexpected blob read for ${pointer.blobKey}`);
    }
    return content;
  }

  async putFile(key: string, filePath: string, metadata?: Record<string, string>): Promise<BlobPointer> {
    this.putFileCalls += 1;
    this.stored.set(key, await readFile(filePath));
    return {
      storageDriver: "local",
      blobKey: key,
      metadata: JSON.stringify(metadata || {})
    };
  }

  async getToFile(_pointer: BlobPointer, targetPath: string): Promise<void> {
    this.getToFileCalls += 1;
    await writeFile(targetPath, this.encryptedImportSource);
  }

  async delete(pointer: BlobPointer): Promise<void> {
    this.deleteCalls += 1;
    this.stored.delete(pointer.blobKey);
  }
}

describe("ArchiveServices oversized import worker", () => {
  it("keeps the decrypted zip available until attachments are materialized", async () => {
    const db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();
    await runMigrations(pool as never);

    const uploadTmpDir = await mkdtemp(path.join(os.tmpdir(), "ownwa-worker-uploads-"));
    const blobRoot = await mkdtemp(path.join(os.tmpdir(), "ownwa-worker-blobs-"));
    const config: AppConfig = {
      databaseUrl: "postgres://unused/test",
      port: 4000,
      sessionSecret: "session-secret-for-tests",
      appOrigin: "http://localhost:5173",
      encryptionKey: Buffer.from("development-encryption-key-12345"),
      maxImportBytes: 10737418240,
      uploadTmpDir,
      importWorkerIntervalMs: 2000,
      importWorkerBatchSize: 10,
      largeImportThresholdBytes: 2 * 1024 ** 3,
      importProgressStepPercent: 5,
      blobDriver: "local",
      blobRoot,
      s3ForcePathStyle: false
    };

    const attachmentBody = Buffer.from("large-worker-attachment");
    const zipBuffer = await buildZipExport(
      "Project Room",
      [
        "31/12/2024, 21:30 - Alex: IMG-20241231-WA0001.jpg",
        "31/12/2024, 21:31 - Joey: Nice shot"
      ],
      {
        "IMG-20241231-WA0001.jpg": attachmentBody
      }
    );

    const storage = new StubBlobStorage(encryptForLargeImportSource(zipBuffer, config.encryptionKey));
    const services = new ArchiveServices({
      db: pool as never,
      logger: pino({ level: "silent" }),
      config,
      storage
    });

    try {
      const ownerId = "user-large-worker";
      const fileSha256 = createHash("sha256").update(zipBuffer).digest("hex");
      await pool.query(
        "INSERT INTO users (id, username, password_hash, self_display_name) VALUES ($1, $2, $3, $4)",
        [ownerId, "joey", "test-password-hash", "Joey"]
      );
      await pool.query(
        `INSERT INTO imports (
          id, owner_id, status, file_name, file_sha256, source_blob_key, source_blob_storage,
          source_blob_metadata, source_size, source_chat_title, normalized_chat_title, import_options
        )
        VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          "import-large-worker",
          ownerId,
          "Project Room.zip",
          fileSha256,
          "imports/user-large-worker/import-large-worker.bin",
          "local",
          "{}",
          2 * 1024 ** 3 + 1,
          "Project Room",
          "project room",
          JSON.stringify({
            selfDisplayName: "Joey"
          })
        ]
      );

      await services.processPendingImports();

      const importResult = await pool.query(
        "SELECT status, error_message, parse_summary FROM imports WHERE id = $1",
        ["import-large-worker"]
      );
      expect(importResult.rows[0]?.status).toBe("completed");
      expect(importResult.rows[0]?.error_message).toBeNull();
      expect(JSON.parse(String(importResult.rows[0]?.parse_summary)).attachmentsStored).toBe(1);

      const chats = await services.listChats(ownerId);
      expect(chats).toHaveLength(1);
      const messages = await services.getChatMessages(ownerId, chats[0]!.id);
      expect(messages.messages[0]?.attachments).toHaveLength(1);
      expect(messages.messages[0]?.attachments[0]?.fileName).toBe("IMG-20241231-WA0001.jpg");

      expect(storage.getToFileCalls).toBe(1);
      expect(storage.getCalls).toBe(0);
      expect(storage.putCalls).toBe(1);

      const uploadEntries = await readdir(uploadTmpDir);
      expect(uploadEntries.filter((entry) => entry.startsWith("import-process-"))).toHaveLength(0);
    } finally {
      await pool.end();
      await rm(blobRoot, { recursive: true, force: true });
      await rm(uploadTmpDir, { recursive: true, force: true });
    }
  });
});
