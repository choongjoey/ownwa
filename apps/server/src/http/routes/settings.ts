import type { Express } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils.js";
import type { AuthenticatedRequest, AuthenticatedRequestHandler, RouteModuleOptions } from "../types.js";

const settingsSchema = z.object({
  selfDisplayName: z.string().trim().max(120).default("")
});

export function registerSettingsRoutes(
  app: Express,
  { services }: RouteModuleOptions,
  requireAuth: AuthenticatedRequestHandler
) {
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
}
