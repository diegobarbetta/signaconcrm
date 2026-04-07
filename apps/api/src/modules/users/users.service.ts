import argon2 from "argon2";
import type { PrismaClient } from "@prisma/client";

import { writeAuditLog } from "../audit/audit.service.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  status: string;
  role: { id: string; name: string };
  created_at: string;
  updated_at: string;
};

function toPublic(u: {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  role: { id: string; name: string };
}): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    role: { id: u.role.id, name: u.role.name },
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

export async function listUsers(prisma: PrismaClient): Promise<PublicUser[]> {
  const rows = await prisma.user.findMany({
    orderBy: { email: "asc" },
    include: { role: true },
  });
  return rows.map(toPublic);
}

export async function createUser(
  prisma: PrismaClient,
  input: {
    name: string;
    email: string;
    password: string;
    role: string;
  },
  options?: { actorUserId: string },
): Promise<
  | { ok: true; user: PublicUser }
  | { ok: false; error: "validation"; message: string }
  | { ok: false; error: "conflict"; message: string }
> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const roleName = input.role.trim().toLowerCase();

  if (name.length < 1) {
    return { ok: false, error: "validation", message: "Nome é obrigatório" };
  }
  if (email.length < 3 || !email.includes("@")) {
    return { ok: false, error: "validation", message: "Email inválido" };
  }
  if (input.password.length < 8) {
    return {
      ok: false,
      error: "validation",
      message: "Password deve ter pelo menos 8 caracteres",
    };
  }

  const role = await prisma.role.findUnique({
    where: { name: roleName },
  });
  if (!role) {
    return { ok: false, error: "validation", message: "Perfil (role) inválido" };
  }

  const passwordHash = await argon2.hash(input.password);

  try {
    const created = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        roleId: role.id,
        status: "active",
      },
      include: { role: true },
    });

    if (options?.actorUserId) {
      await writeAuditLog(prisma, {
        userId: options.actorUserId,
        action: "users.create",
        entityType: "user",
        entityId: created.id,
        metadata: { role_name: created.role.name },
      });
    }

    return { ok: true, user: toPublic(created) };
  } catch {
    return {
      ok: false,
      error: "conflict",
      message: "Email já registado",
    };
  }
}

export async function updateUser(
  prisma: PrismaClient,
  id: string,
  input: { role?: string; status?: string },
  options?: { actorUserId: string },
): Promise<
  | { ok: true; user: PublicUser }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "validation"; message: string }
> {
  const hasRole = input.role !== undefined;
  const hasStatus = input.status !== undefined;
  if (!hasRole && !hasStatus) {
    return { ok: false, error: "validation", message: "Nada para atualizar" };
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    include: { role: true },
  });
  if (!existing) {
    return { ok: false, error: "not_found" };
  }

  let roleId = existing.roleId;
  if (hasRole) {
    const roleName = input.role!.trim().toLowerCase();
    const role = await prisma.role.findUnique({
      where: { name: roleName },
    });
    if (!role) {
      return { ok: false, error: "validation", message: "Perfil (role) inválido" };
    }
    roleId = role.id;
  }

  let status = existing.status;
  if (hasStatus) {
    const s = input.status!.trim().toLowerCase();
    if (s !== "active" && s !== "disabled") {
      return {
        ok: false,
        error: "validation",
        message: "Estado deve ser active ou disabled",
      };
    }
    status = s;
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      roleId,
      status,
    },
    include: { role: true },
  });

  const updatedFields: string[] = [];
  if (hasRole) {
    updatedFields.push("role");
  }
  if (hasStatus) {
    updatedFields.push("status");
  }
  if (options?.actorUserId) {
    await writeAuditLog(prisma, {
      userId: options.actorUserId,
      action: "users.update",
      entityType: "user",
      entityId: id,
      metadata: { updated_fields: updatedFields },
    });
  }

  return { ok: true, user: toPublic(updated) };
}
