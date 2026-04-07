export function formatCurrencyBRL(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Nao definido";
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("pt-BR")} d`;
}
