/** Segredo HS256 — partilhado entre emissão (login) e verificação (rotas protegidas). */
export function getJwtSecretBytes(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET deve estar definido com pelo menos 32 caracteres.");
  }
  return new TextEncoder().encode(s);
}
