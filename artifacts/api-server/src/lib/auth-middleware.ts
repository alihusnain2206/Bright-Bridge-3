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

/**
 * Inline company-access guard for use inside route handlers (after requireRole).
 *
 * super_admin is cross-company (always returns true).
 * All other roles (owner, manager, employee) are scoped to their own companyId.
 *
 * Sends the appropriate error response and returns false when access is denied,
 * so callers can do: `if (!assertCompanyAccess(req, res, body.companyId)) return;`
 *
 * Authoritative company membership source: store.getUserById(req.session.userId).companyId
 * (backed by testUsers seed + createStaffUser / createManagerUser mutations).
 * DB-persisted users are reflected there via the same store interface.
 */
export function assertCompanyAccess(
  req: Request,
  res: Response,
  companyId: string | undefined,
): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  if (!companyId) {
    res.status(400).json({ error: "companyId is required" });
    return false;
  }
  const user = store.getUserById(req.session.userId);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return false;
  }
  if (user.role === "super_admin") return true;
  if (user.companyId === companyId) return true;
  res.status(403).json({ error: "Access denied: company mismatch" });
  return false;
}
