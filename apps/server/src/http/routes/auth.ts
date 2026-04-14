import type { Express } from "express";
import { z } from "zod";
import { sessionCookieName, sessionCookieOptions } from "../../lib.js";
import { asyncHandler } from "../utils.js";
import type { AuthenticatedRequest, RouteModuleOptions } from "../types.js";

const authSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128)
});

export function registerAuthRoutes(app: Express, { services }: RouteModuleOptions) {
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
}
