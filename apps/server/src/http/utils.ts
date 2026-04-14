import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../lib.js";
import type { AsyncRouteHandler } from "./types.js";

export function asyncHandler<T extends Request>(handler: AsyncRouteHandler<T>) {
  return (req: T, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export async function safeUnlink(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }
  try {
    await unlink(filePath);
  } catch {
    // Best-effort temp file cleanup.
  }
}

export function describeImportLimit(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function parseRangeHeader(
  rangeHeader: string | undefined,
  contentLength: number
): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }
  const [startRaw, endRaw] = rangeHeader.replace("bytes=", "").split("-", 2);
  const hasStart = startRaw !== undefined && startRaw !== "";
  const hasEnd = endRaw !== undefined && endRaw !== "";
  if (!hasStart && !hasEnd) {
    return null;
  }

  let start = hasStart ? Number.parseInt(startRaw, 10) : Number.NaN;
  let end = hasEnd ? Number.parseInt(endRaw, 10) : Number.NaN;

  if (!hasStart && Number.isFinite(end)) {
    const suffixLength = end;
    if (suffixLength <= 0) {
      return null;
    }
    start = Math.max(contentLength - suffixLength, 0);
    end = contentLength - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) {
      return null;
    }
    if (!Number.isFinite(end) || end >= contentLength) {
      end = contentLength - 1;
    }
  }

  if (start > end || start >= contentLength) {
    return null;
  }

  return { start, end };
}

export function createUploadMiddleware(config: AppConfig) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        callback(null, config.uploadTmpDir);
      },
      filename: (_req, file, callback) => {
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(file.originalname)}`;
        callback(null, safeName);
      }
    }),
    limits: {
      fileSize: config.maxImportBytes
    }
  });
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join(", ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected server error";
}
