export const leadStatusLabels: Record<string, string> = {
  new: "Novo",
  contacted: "Em contato",
  qualified: "Qualificado",
  lost: "Perdido",
  archived_client: "Arquivado (ex-cliente)",
};

export const demandStatusLabels: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  done: "Concluida",
};

export const taskStatusLabels: Record<string, string> = {
  open: "Aberta",
  done: "Concluida",
};

export const conversationStatusLabels: Record<string, string> = {
  unanswered: "Sem resposta",
  answered: "Respondida",
};

export function labelForStatus(
  value: string,
  labels: Record<string, string>,
): string {
  return labels[value] ?? value;
}
