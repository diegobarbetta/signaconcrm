import { createHash, randomBytes } from "node:crypto";

import argon2 from "argon2";
import type { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

import { getJwtSecretBytes } from "../../lib/jwt.js";
import { writeAuditLog } from "../audit/audit.service.js";

export const GENERIC_LOGIN_ERROR = "Credenciais inválidas";
export const GENERIC_REFRESH_ERROR = "Sessão inválida";

export type TokenPairSuccess = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
};

type UserForToken = {
  id: string;
  email: string;
  role: { name: string };
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function accessExpiresSec(): number {
  const raw = process.env.JWT_ACCESS_EXPIRES_SEC;
  if (raw === undefined || raw === "") {
    return 900;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 60) {
    return 900;
  }
  return n;
}

export function refreshExpiresAt(): Date {
  const daysRaw = process.env.REFRESH_TOKEN_EXPIRES_DAYS;
  const days =
    daysRaw === undefined || daysRaw === ""
      ? 7
      : Number.parseInt(daysRaw, 10);
  const d = Number.isFinite(days) && days >= 1 ? days : 7;
  const ms = d * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

export async function signAccessTokenForUser(
  user: UserForToken,
): Promise<{ access_token: string; expires_in: number }> {
  const accessSec = accessExpiresSec();
  const secret = getJwtSecretBytes();

  const accessToken = await new SignJWT({
    email: user.email,
    role: user.role.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${accessSec}s`)
    .sign(secret);

  return {
    access_token: accessToken,
    expires_in: accessSec,
  };
}

export async function loginWithPassword(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<TokenPairSuccess | { error: typeof GENERIC_LOGIN_ERROR }> {
  const normalized = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: { role: true },
  });

  if (!user || user.status !== "active") {
    return { error: GENERIC_LOGIN_ERROR };
  }

  let passwordOk = false;
  try {
    passwordOk = await argon2.verify(user.passwordHash, password);
  } catch {
    passwordOk = false;
  }

  if (!passwordOk) {
    return { error: GENERIC_LOGIN_ERROR };
  }

  const { access_token, expires_in } = await signAccessTokenForUser(user);

  const refreshRaw = randomBytes(32).toString("base64url");
  const refreshTokenHash = sha256Hex(refreshRaw);
  const expiresAt = refreshExpiresAt();

  await prisma.userSession.create({
    data: {
      userId: user.id,
      refreshTokenHash,
      expiresAt,
    },
  });

  await writeAuditLog(prisma, {
    userId: user.id,
    action: "auth.login",
    metadata: {},
  });

  return {
    access_token,
    refresh_token: refreshRaw,
    token_type: "Bearer",
    expires_in,
  };
}

export async function refreshWithRefreshToken(
  prisma: PrismaClient,
  refreshToken: string,
): Promise<TokenPairSuccess | { error: typeof GENERIC_REFRESH_ERROR }> {
  const trimmed = refreshToken.trim();
  if (!trimmed) {
    return { error: GENERIC_REFRESH_ERROR };
  }

  const hash = sha256Hex(trimmed);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.userSession.findFirst({
      where: {
        refreshTokenHash: hash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        user: { include: { role: true } },
      },
    });

    if (!session || session.user.status !== "active") {
      return null;
    }

    await tx.userSession.update({
      where: { id: session.id },
      data: { revokedAt: now },
    });

    const newRefreshRaw = randomBytes(32).toString("base64url");
    const newHash = sha256Hex(newRefreshRaw);
    const expiresAt = refreshExpiresAt();

    await tx.userSession.create({
      data: {
        userId: session.userId,
        refreshTokenHash: newHash,
        expiresAt,
      },
    });

    const { access_token, expires_in } = await signAccessTokenForUser(session.user);

    return {
      access_token,
      refresh_token: newRefreshRaw,
      token_type: "Bearer" as const,
      expires_in,
    };
  });

  if (!result) {
    return { error: GENERIC_REFRESH_ERROR };
  }

  return result;
}

export async function logoutWithRefreshToken(
  prisma: PrismaClient,
  refreshToken: string,
): Promise<{ ok: true } | { error: typeof GENERIC_REFRESH_ERROR }> {
  const trimmed = refreshToken.trim();
  if (!trimmed) {
    return { error: GENERIC_REFRESH_ERROR };
  }

  const hash = sha256Hex(trimmed);
  const now = new Date();

  const session = await prisma.userSession.findFirst({
    where: {
      refreshTokenHash: hash,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });

  if (!session) {
    return { error: GENERIC_REFRESH_ERROR };
  }

  await prisma.userSession.update({
    where: { id: session.id },
    data: { revokedAt: now },
  });

  await writeAuditLog(prisma, {
    userId: session.userId,
    action: "auth.logout",
    entityType: "user_session",
    entityId: session.id,
  });

  return { ok: true };
}
