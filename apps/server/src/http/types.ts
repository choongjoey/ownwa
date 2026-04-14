import type { NextFunction, Request, Response } from "express";
import type { Multer } from "multer";
import type pino from "pino";
import type { AppConfig, ArchiveServices, SafeUser } from "../lib.js";

export interface AuthenticatedRequest extends Request {
  authUser?: SafeUser;
  sessionToken?: string;
}

export type AsyncRouteHandler<T extends Request = Request> = (
  req: T,
  res: Response,
  next: NextFunction
) => Promise<void>;

export type AuthenticatedRequestHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => void;

export interface RouteModuleOptions {
  config: AppConfig;
  logger: pino.Logger;
  services: ArchiveServices;
}

export interface ImportRouteModuleOptions extends RouteModuleOptions {
  upload: Multer;
}
