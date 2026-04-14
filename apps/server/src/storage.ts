import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppConfig, BlobDriverKind } from "./config.js";

export interface BlobPointer {
  storageDriver: BlobDriverKind;
  blobKey: string;
  metadata: string;
}

export interface BlobStorage {
  put(key: string, content: Buffer, metadata?: Record<string, string>): Promise<BlobPointer>;
  get(pointer: BlobPointer): Promise<Buffer>;
  putFile(key: string, filePath: string, metadata?: Record<string, string>): Promise<BlobPointer>;
  getToFile(pointer: BlobPointer, targetPath: string): Promise<void>;
  delete(pointer: BlobPointer): Promise<void>;
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

async function streamToFile(body: unknown, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (body instanceof Readable) {
    await pipeline(body, createWriteStream(targetPath));
    return;
  }
  if (body && typeof body === "object" && "transformToByteArray" in body) {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    await writeFile(targetPath, bytes);
    return;
  }
  throw new Error("Unsupported blob response body");
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

  async putFile(key: string, filePath: string, metadata?: Record<string, string>): Promise<BlobPointer> {
    const finalPath = path.join(this.root, key);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await copyFile(filePath, finalPath);
    return {
      storageDriver: "local",
      blobKey: key,
      metadata: JSON.stringify({
        ...metadata,
        relativePath: key
      })
    };
  }

  async getToFile(pointer: BlobPointer, targetPath: string): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(path.join(this.root, pointer.blobKey), targetPath);
  }

  async delete(pointer: BlobPointer): Promise<void> {
    await rm(path.join(this.root, pointer.blobKey), { force: true });
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

  async putFile(key: string, filePath: string, metadata?: Record<string, string>): Promise<BlobPointer> {
    if (!this.config.s3Bucket) {
      throw new Error("S3_BUCKET is required when BLOB_DRIVER=s3");
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: createReadStream(filePath),
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

  async getToFile(pointer: BlobPointer, targetPath: string): Promise<void> {
    if (!this.config.s3Bucket) {
      throw new Error("S3_BUCKET is required when BLOB_DRIVER=s3");
    }
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: pointer.blobKey
      })
    );
    await streamToFile(response.Body, targetPath);
  }

  async delete(pointer: BlobPointer): Promise<void> {
    if (!this.config.s3Bucket) {
      throw new Error("S3_BUCKET is required when BLOB_DRIVER=s3");
    }
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: pointer.blobKey
      })
    );
  }
}

export function createBlobStorage(config: AppConfig): BlobStorage {
  if (config.blobDriver === "s3") {
    return new S3BlobStorage(config);
  }
  return new LocalBlobStorage(config.blobRoot);
}
