import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import pinoHttp from "pino-http";
import { Pool } from "pg";
import { z } from "zod";
import {
  ArchiveServices,
  createBlobStorage,
  createConfig,
  runMigrations,
  sessionCookieName,
  sessionCookieOptions,
  type AppConfig,
  type SafeUser
} from "./lib.js";

export interface CreateAppOptions {
  config?: AppConfig;
  pool?: Pool;
  logger?: pino.Logger;
  startWorker?: boolean;
}

interface AuthenticatedRequest extends Request {
  authUser?: SafeUser;
  sessionToken?: string;
}

const authSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128)
});

const settingsSchema = z.object({
  selfDisplayName: z.string().trim().max(120).default("")
});

const chatTitleSchema = z.object({
  displayTitle: z.string().trim().max(160)
});

function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: T, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

async function safeUnlink(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }
  try {
    await unlink(filePath);
  } catch {
    // Best-effort temp file cleanup.
  }
}

function describeImportLimit(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 0 : 1)} ${units[index]}`;
}

function parseRangeHeader(
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

  let start = hasStart ? Number.parseInt(startRaw, 10) : NaN;
  let end = hasEnd ? Number.parseInt(endRaw, 10) : NaN;

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

export async function createApp(options: CreateAppOptions = {}) {
  const config = options.config || createConfig();
  const logger = options.logger || pino({ level: process.env.LOG_LEVEL || "info" });
  const pool = options.pool || new Pool({ connectionString: config.databaseUrl });
  await runMigrations(pool);
  await mkdir(config.uploadTmpDir, { recursive: true });
  const services = new ArchiveServices({
    db: pool,
    config,
    logger,
    storage: createBlobStorage(config)
  });
  const upload = multer({
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

  const app = express();
  app.use(
    cors({
      origin: config.appOrigin,
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(
    pinoHttp({
      logger
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    asyncHandler<AuthenticatedRequest>(async (req, _res, next) => {
      const token = req.cookies?.[sessionCookieName];
      if (!token) {
        return next();
      }
      const user = await services.getUserBySessionToken(token);
      if (user) {
        req.authUser = user;
        req.sessionToken = token;
      }
      return next();
    })
  );

  const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required" });
    }
    return next();
  };

  app.post(
    "/api/auth/register",
    asyncHandler(async (req, res) => {
      const body = authSchema.parse(req.body);
      const result = await services.registerUser(body.username, body.password);
      res.cookie(sessionCookieName, result.sessionToken, sessionCookieOptions);
      res.status(201).json({ user: result.user });
    })
  );

  app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
      const body = authSchema.parse(req.body);
      const result = await services.loginUser(body.username, body.password);
      res.cookie(sessionCookieName, result.sessionToken, sessionCookieOptions);
      res.json({ user: result.user });
    })
  );

  app.post(
    "/api/auth/logout",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (req.sessionToken) {
        await services.logoutSession(req.sessionToken);
      }
      res.clearCookie(sessionCookieName, sessionCookieOptions);
      res.status(204).send();
    })
  );

  app.get(
    "/api/auth/me",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ user: req.authUser || null });
    })
  );

  app.get(
    "/api/settings",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ settings: await services.getUserSettings(req.authUser!.id) });
    })
  );

  app.patch(
    "/api/settings",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const body = settingsSchema.parse(req.body);
      res.json({ settings: await services.updateUserSettings(req.authUser!.id, body) });
    })
  );

  app.post(
    "/api/imports",
    requireAuth,
    upload.single("file"),
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: "An export file is required" });
        return;
      }
      const settings = await services.getUserSettings(req.authUser!.id);
      try {
        const created = await services.createImportFromFile(req.authUser!.id, req.file.originalname, req.file.path, {
          selfDisplayName: settings.selfDisplayName
        });
        res.status(201).json({ import: created });
      } catch (error) {
        const existingImportId =
          error && typeof error === "object" && "existingImportId" in error
            ? (error as { existingImportId?: string }).existingImportId
            : undefined;
        if (existingImportId) {
          res.status(409).json({
            error: error instanceof Error ? error.message : "Duplicate import",
            existingImportId
          });
          return;
        }
        throw error;
      } finally {
        await safeUnlink(req.file?.path);
      }
    })
  );

  app.get(
    "/api/imports",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ imports: await services.listImports(req.authUser!.id) });
    })
  );

  app.get(
    "/api/imports/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const item = await services.getImport(req.authUser!.id, String(req.params.id));
      if (!item) {
        res.status(404).json({ error: "Import not found" });
        return;
      }
      res.json({ import: item });
    })
  );

  app.get(
    "/api/chats",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ chats: await services.listChats(req.authUser!.id) });
    })
  );

  app.get(
    "/api/chats/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const chat = await services.getChat(req.authUser!.id, String(req.params.id));
      if (!chat) {
        res.status(404).json({ error: "Chat not found" });
        return;
      }
      res.json({ chat });
    })
  );

  app.patch(
    "/api/chats/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const body = chatTitleSchema.parse(req.body);
      const chat = await services.updateChatTitle(req.authUser!.id, String(req.params.id), body.displayTitle);
      if (!chat) {
        res.status(404).json({ error: "Chat not found" });
        return;
      }
      res.json({ chat });
    })
  );

  app.get(
    "/api/chats/:id/messages",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ messages: await services.getChatMessages(req.authUser!.id, String(req.params.id)) });
    })
  );

  app.get(
    "/api/search",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      res.json({ results: await services.searchAllChats(req.authUser!.id, q) });
    })
  );

  app.get(
    "/api/chats/:id/search",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      res.json({ results: await services.searchChat(req.authUser!.id, String(req.params.id), q) });
    })
  );

  app.get(
    "/api/chats/:id/stats",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ stats: await services.getChatStats(req.authUser!.id, String(req.params.id)) });
    })
  );

  app.get(
    "/api/attachments/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const attachment = await services.getAttachmentForUser(req.authUser!.id, String(req.params.id));
      if (!attachment) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${attachment.fileName.replace(/"/g, "")}"`
      );
      const range = parseRangeHeader(req.headers.range, attachment.content.byteLength);
      if (range) {
        res.status(206);
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${attachment.content.byteLength}`);
        res.setHeader("Content-Length", String(range.end - range.start + 1));
        res.send(attachment.content.subarray(range.start, range.end + 1));
        return;
      }
      if (req.headers.range) {
        res.status(416);
        res.setHeader("Content-Range", `bytes */${attachment.content.byteLength}`);
        res.end();
        return;
      }
      res.setHeader("Content-Length", String(attachment.content.byteLength));
      res.send(attachment.content);
    })
  );

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `Import exceeds the current upload limit of ${describeImportLimit(config.maxImportBytes)}`
      });
      return;
    }
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join(", ")
        : error instanceof Error
          ? error.message
          : "Unexpected server error";
    const status = error instanceof z.ZodError ? 400 : 500;
    logger.error({ err: error }, "Request failed");
    res.status(status).json({ error: message });
  });

  if (options.startWorker !== false) {
    services.startWorker();
  }

  return {
    app,
    services,
    pool,
    async close() {
      services.stopWorker();
      await pool.end();
    }
  };
}
