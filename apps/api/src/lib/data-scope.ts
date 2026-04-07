/**
 * Escopo de dados por perfil (Story 1.5) — reutilizável em listagens com `assigned_user_id`, etc.
 * `team`: até existir modelo de equipa, usar `teamUserIds` (ex.: colegas) ou lista vazia (= só próprio).
 */
export type DataScope = "own" | "team" | "all";

export function parseDataScope(raw: string): DataScope {
  if (raw === "all" || raw === "team" || raw === "own") {
    return raw;
  }
  return "own";
}

/** Filtro Prisma para campo `assignedUserId` / `assigned_user_id` (camelCase no Prisma). */
export function assignedUserScopeWhere(
  scope: DataScope,
  currentUserId: string,
  teamUserIds: string[] = [],
): { assignedUserId: string } | { assignedUserId: { in: string[] } } | Record<string, never> {
  if (scope === "all") {
    return {};
  }
  if (scope === "own") {
    return { assignedUserId: currentUserId };
  }
  const ids = [currentUserId, ...teamUserIds];
  return { assignedUserId: { in: ids } };
}
