export function formatCurrencyInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  const amount = Number(digits) / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

export function currencyInputToNumber(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  return Number(digits) / 100;
}

export function numberToCurrencyInput(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return formatCurrencyInput(String(Math.round(value * 100)));
}
