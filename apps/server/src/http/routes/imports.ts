import type { Express } from "express";
import { ImportActionError } from "../../lib.js";
import type { AuthenticatedRequest, AuthenticatedRequestHandler, ImportRouteModuleOptions } from "../types.js";
import { asyncHandler, safeUnlink } from "../utils.js";

export function registerImportRoutes(
  app: Express,
  { services, upload }: ImportRouteModuleOptions,
  requireAuth: AuthenticatedRequestHandler
) {
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

  app.post(
    "/api/imports/:id/retry",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const settings = await services.getUserSettings(req.authUser!.id);
      try {
        const item = await services.retryImport(req.authUser!.id, String(req.params.id), {
          selfDisplayName: settings.selfDisplayName
        });
        if (!item) {
          res.status(404).json({ error: "Import not found" });
          return;
        }
        res.json({ import: item });
      } catch (error) {
        if (error instanceof ImportActionError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        throw error;
      }
    })
  );

  app.delete(
    "/api/imports/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        const cleared = await services.clearImport(req.authUser!.id, String(req.params.id));
        if (!cleared) {
          res.status(404).json({ error: "Import not found" });
          return;
        }
        res.status(204).end();
      } catch (error) {
        if (error instanceof ImportActionError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        throw error;
      }
    })
  );
}
