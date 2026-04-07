import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { DemandRow, TaskRow } from "../api";

/** Demanda: exclusivamente lead OU cliente na BD. */
export function demandContext(
  d: Pick<DemandRow, "client_id" | "lead_id">,
): "client" | "lead" | "none" {
  if (d.client_id) return "client";
  if (d.lead_id) return "lead";
  return "none";
}

/** Tarefa: prioridade cliente (demanda ou lead convertido) > lead > conversa. */
export function taskContext(
  t: Pick<
    TaskRow,
    | "lead_id"
    | "client_id"
    | "conversation_id"
    | "demand_id"
    | "demand_lead_id"
    | "demand_client_id"
    | "lead_client_id"
  >,
): "client" | "lead" | "conversation" | "none" {
  if (t.client_id || t.demand_client_id || t.lead_client_id) return "client";
  if (t.lead_id || t.demand_lead_id) return "lead";
  if (t.conversation_id) return "conversation";
  return "none";
}

export function ContextTag({
  kind,
  label,
}: {
  kind: "client" | "lead" | "conversation" | "none";
  label?: string;
}) {
  const text =
    label ??
    (kind === "client"
      ? "Cliente"
      : kind === "lead"
        ? "Lead"
        : kind === "conversation"
          ? "Conversa"
          : "Sem vínculo");
  const variantCls =
    kind === "client"
      ? "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100"
      : kind === "lead"
        ? "border-chart-2/40 bg-chart-2/10 text-chart-4"
        : kind === "conversation"
          ? "border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-100"
          : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("font-medium", variantCls)}>
      {text}
    </Badge>
  );
}

export function IdLinksDemand({ d }: { d: DemandRow }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      {d.lead_id ? (
        <Link
          to={`/leads/${d.lead_id}`}
          className="font-mono text-primary hover:underline"
        >
          lead → {d.lead_id.slice(0, 8)}…
        </Link>
      ) : null}
      {d.client_id ? (
        <Link
          to={`/clients/${d.client_id}`}
          className="font-mono text-sky-700 underline-offset-4 hover:underline dark:text-sky-300"
        >
          cliente → {d.client_id.slice(0, 8)}…
        </Link>
      ) : null}
    </div>
  );
}

export function IdLinksTask({ t }: { t: TaskRow }) {
  const clientId = t.client_id ?? t.demand_client_id ?? t.lead_client_id;
  const leadRef = clientId == null ? (t.lead_id ?? t.demand_lead_id) : null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
      {leadRef ? (
        <Link to={`/leads/${leadRef}`} className="text-primary hover:underline">
          lead {leadRef.slice(0, 8)}…
        </Link>
      ) : null}
      {clientId ? (
        <Link
          to={`/clients/${clientId}`}
          className="text-sky-700 hover:underline dark:text-sky-300"
        >
          cliente {clientId.slice(0, 8)}…
        </Link>
      ) : null}
      {t.conversation_id ? (
        <Link
          to={`/inbox/${t.conversation_id}`}
          className="text-violet-700 hover:underline dark:text-violet-300"
        >
          conversa {t.conversation_id.slice(0, 8)}…
        </Link>
      ) : null}
      {t.demand_id ? (
        <span title="ID da demanda vinculada">
          demanda {t.demand_id.slice(0, 8)}…
        </span>
      ) : null}
    </div>
  );
}
