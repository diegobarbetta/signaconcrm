/**
 * Compatível com Story 1.4 — equivalente a `requirePermission("users.manage")`.
 */
import { requirePermission } from "./require-permission.js";

export { type AuthUser } from "./require-permission.js";

export const requireAdmin = requirePermission("users.manage");
