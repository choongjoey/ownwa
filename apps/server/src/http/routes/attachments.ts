import type { Express } from "express";
import { asyncHandler, parseRangeHeader } from "../utils.js";
import type { AuthenticatedRequest, AuthenticatedRequestHandler, RouteModuleOptions } from "../types.js";

export function registerAttachmentRoutes(
  app: Express,
  { services }: RouteModuleOptions,
  requireAuth: AuthenticatedRequestHandler
) {
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
      res.setHeader("Content-Disposition", `inline; filename="${attachment.fileName.replace(/"/g, "")}"`);
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
}
