import { Prisma } from "@prisma/client";

const MONEY_INPUT_REGEX = /^-?\d+(?:[.,]\d{1,2})?$/;

export function parseMoneyInput(
  input: string | number | null | undefined,
): { ok: true; value: Prisma.Decimal | null | undefined } | { ok: false } {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }
  if (input === null) {
    return { ok: true, value: null };
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return { ok: false };
    }
    return { ok: true, value: new Prisma.Decimal(input.toFixed(2)) };
  }

  const normalized = input.trim();
  if (normalized === "") {
    return { ok: true, value: null };
  }
  if (!MONEY_INPUT_REGEX.test(normalized)) {
    return { ok: false };
  }

  return {
    ok: true,
    value: new Prisma.Decimal(normalized.replace(",", ".")),
  };
}

export function moneyToNumber(
  value:
    | Prisma.Decimal
    | string
    | number
    | null
    | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}
