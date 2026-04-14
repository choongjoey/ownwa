import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Response } from "express";
import multer from "multer";
import { mkdir } from "node:fs/promises";
import pino from "pino";
import pinoHttp from "pino-http";
import { Pool } from "pg";
import { z } from "zod";
import {
  createBlobStorage,
  createConfig,
  runMigrations,
  sessionCookieName,
  type AppConfig
} from "./lib.js";
import { registerAttachmentRoutes } from "./http/routes/attachments.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerChatRoutes } from "./http/routes/chats.js";
import { registerImportRoutes } from "./http/routes/imports.js";
import { registerSettingsRoutes } from "./http/routes/settings.js";
import type { AuthenticatedRequest, AuthenticatedRequestHandler } from "./http/types.js";
import { asyncHandler, createUploadMiddleware, describeImportLimit, toErrorMessage } from "./http/utils.js";
import { ArchiveServices } from "./lib.js";

export interface CreateAppOptions {
  config?: AppConfig;
  pool?: Pool;
  logger?: pino.Logger;
  startWorker?: boolean;
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
  const upload = createUploadMiddleware(config);

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

  const requireAuth: AuthenticatedRequestHandler = (req, res, next) => {
    if (!req.authUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  };

  registerAuthRoutes(app, { config, logger, services });
  registerSettingsRoutes(app, { config, logger, services }, requireAuth);
  registerImportRoutes(app, { config, logger, services, upload }, requireAuth);
  registerChatRoutes(app, { config, logger, services }, requireAuth);
  registerAttachmentRoutes(app, { config, logger, services }, requireAuth);

  app.use((error: unknown, _req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `Import exceeds the current upload limit of ${describeImportLimit(config.maxImportBytes)}`
      });
      return;
    }

    const status = error instanceof z.ZodError ? 400 : 500;
    logger.error({ err: error }, "Request failed");
    res.status(status).json({ error: toErrorMessage(error) });
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
