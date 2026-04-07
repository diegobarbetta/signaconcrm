import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify } from "jose";

import { getJwtSecretBytes } from "../../lib/jwt.js";
import { parseDataScope, type DataScope } from "../../lib/data-scope.js";

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  roleId: string;
  dataScope: DataScope;
  permissions: string[];
};

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Não autenticado" });
    return false;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    reply.code(401).send({ error: "Não autenticado" });
    return false;
  }

  let sub: string;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    const s = payload.sub;
    if (!s) {
      reply.code(401).send({ error: "Token inválido" });
      return false;
    }
    sub = s;
  } catch {
    reply.code(401).send({ error: "Token inválido" });
    return false;
  }

  const user = await request.server.prisma.user.findUnique({
    where: { id: sub },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  if (!user || user.status !== "active") {
    reply.code(401).send({ error: "Não autenticado" });
    return false;
  }

  const permissions = user.role.rolePermissions.map((rp) => rp.permission.code);
  const dataScope = parseDataScope(user.role.dataScope);

  request.authUser = {
    id: user.id,
    email: user.email,
    role: user.role.name,
    roleId: user.roleId,
    dataScope,
    permissions,
  };

  return true;
}

/** Qualquer utilizador autenticado (ativo). Preenche `request.authUser`. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authenticateRequest(request, reply);
  // Se falhou, `reply` já foi enviado — o Fastify não corre o handler da rota.
}

/** Exige permissão `code` na BD (via role_permissions). */
export function requirePermission(code: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ok = await authenticateRequest(request, reply);
    if (!ok) {
      return;
    }
    if (!request.authUser!.permissions.includes(code)) {
      reply.code(403).send({ error: "Acesso negado" });
    }
  };
}

/**
 * Exige a permissão `code` na BD, excepto se o papel do utilizador for `admin`
 * (fallback quando a BD ainda não tem `role_permissions` actualizado).
 */
export function requirePermissionUnlessAdminRole(code: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ok = await authenticateRequest(request, reply);
    if (!ok) {
      return;
    }
    const u = request.authUser!;
    if (u.role === "admin") {
      return;
    }
    if (!u.permissions.includes(code)) {
      reply.code(403).send({ error: "Acesso negado" });
    }
  };
}

/** Exige pelo menos uma das permissões listadas. */
export function requireAnyPermission(...codes: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ok = await authenticateRequest(request, reply);
    if (!ok) {
      return;
    }
    const perms = request.authUser!.permissions;
    if (!codes.some((c) => perms.includes(c))) {
      reply.code(403).send({ error: "Acesso negado" });
    }
  };
}
