import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "Defina SEED_ADMIN_PASSWORD no .env (mín. 8 caracteres) antes de correr o seed.",
    );
  }

  const roleAdmin = await prisma.role.upsert({
    where: { name: "admin" },
    create: {
      id: randomUUID(),
      name: "admin",
      dataScope: "all",
    },
    update: { dataScope: "all" },
  });

  const roleAtendimento = await prisma.role.upsert({
    where: { name: "atendimento" },
    create: {
      id: randomUUID(),
      name: "atendimento",
      dataScope: "own",
    },
    update: { dataScope: "own" },
  });

  /** Permissões atribuídas ao papel admin em dev (alinhado aos módulos da API). */
  const adminPermissionCodes = [
    "users.manage",
    "rbac.smoke",
    "audit.read",
    "dashboard.read",
    "tasks.create",
    "tasks.read",
    "tasks.update",
    "demands.create",
    "demands.read",
    "demands.update",
    "clients.read",
    "clients.manage",
    "leads.create_manual",
    "leads.update_profile",
    "leads.update_status",
    "leads.assign",
    "leads.convert",
    "leads.delete",
    "whatsapp.metrics.read",
    "whatsapp.conversations.assign",
  ] as const;

  const adminPerms: { id: string; code: string }[] = [];
  for (const code of adminPermissionCodes) {
    const p = await prisma.permission.upsert({
      where: { code },
      create: { id: randomUUID(), code },
      update: {},
    });
    adminPerms.push(p);
  }

  await prisma.rolePermission.createMany({
    data: adminPerms.map((p) => ({
      roleId: roleAdmin.id,
      permissionId: p.id,
    })),
    skipDuplicates: true,
  });

  /** Atendimento: mesmo núcleo operacional do CRM, sem administração de utilizadores / auditoria / smoke RBAC. */
  const atendimentoExclude = new Set([
    "users.manage",
    "rbac.smoke",
    "audit.read",
    "leads.delete",
  ]);
  await prisma.rolePermission.createMany({
    data: adminPerms
      .filter((p) => !atendimentoExclude.has(p.code))
      .map((p) => ({
        roleId: roleAtendimento.id,
        permissionId: p.id,
      })),
    skipDuplicates: true,
  });

  const passwordHash = await argon2.hash(password);

  await prisma.user.upsert({
    where: { email: "admin@signacon.local" },
    create: {
      id: randomUUID(),
      name: "Administrador (seed)",
      email: "admin@signacon.local",
      passwordHash,
      roleId: roleAdmin.id,
      status: "active",
    },
    update: {
      passwordHash,
      status: "active",
    },
  });

  const nAtend = adminPerms.filter((p) => !atendimentoExclude.has(p.code)).length;
  console.log(
    `Seed OK: admin=${adminPermissionCodes.length} perms (all scope); atendimento=${nAtend} perms (own scope); admin@signacon.local`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
