import type { Request, Response, NextFunction } from "express";
import { store } from "../store.js";

/**
 * Requires a valid session. Returns 401 if not authenticated.
 * Use as route middleware: `router.get("/path", requireAuth, handler)`
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

/**
 * Requires a valid session AND one of the specified roles.
 * Returns 401 if not authenticated, 403 if wrong role.
 * Use as route middleware: `router.post("/path", requireRole("super_admin","manager"), handler)`
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = store.getUserById(req.session.userId);
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
