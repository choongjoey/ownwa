import type { Express } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils.js";
import type { AuthenticatedRequest, AuthenticatedRequestHandler, RouteModuleOptions } from "../types.js";

const chatTitleSchema = z.object({
  displayTitle: z.string().trim().max(160)
});

export function registerChatRoutes(
  app: Express,
  { services }: RouteModuleOptions,
  requireAuth: AuthenticatedRequestHandler
) {
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
      const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
      const beforeOffset =
        typeof req.query.beforeOffset === "string" ? Number.parseInt(req.query.beforeOffset, 10) : undefined;
      const aroundMessageId =
        typeof req.query.aroundMessageId === "string" && req.query.aroundMessageId.trim()
          ? req.query.aroundMessageId.trim()
          : undefined;
      res.json(
        await services.getChatMessages(req.authUser!.id, String(req.params.id), {
          limit,
          beforeOffset,
          aroundMessageId
        })
      );
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
}
