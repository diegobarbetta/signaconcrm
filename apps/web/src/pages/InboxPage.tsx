import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { conversationStatusLabels } from "@/lib/domain-labels";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ViewToggle } from "@/components/view-toggle";

import {
  type ConversationRow,
  fetchConversations,
  patchConversationUnanswered,
} from "../api";
import { KanbanBoard, type KanbanColumnDef } from "../components/KanbanBoard";

const CONV_COLUMNS: KanbanColumnDef[] = [
  {
    id: "unanswered",
    title: "Sem resposta",
    description: "Prioridade imediata",
    className: "border-destructive/20 bg-[linear-gradient(180deg,rgba(255,243,243,0.96),rgba(255,250,250,0.92))]",
  },
  {
    id: "answered",
    title: "Respondida",
    description: "Acompanhadas",
    className: "border-emerald-200/70 bg-[linear-gradient(180deg,rgba(240,253,244,0.96),rgba(250,255,251,0.92))]",
  },
];

function conversationColumnId(c: ConversationRow): string {
  return c.unanswered ? "unanswered" : "answered";
}

export function InboxPage() {
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; rows: ConversationRow[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetchConversations({ limit: 80 })
      .then((rows) => setState({ status: "ok", rows }))
      .catch((err: unknown) =>
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleKanbanMove(
    item: ConversationRow,
    toColumnId: string,
  ): Promise<void> {
    const wantUnanswered = toColumnId === "unanswered";
    if (item.unanswered === wantUnanswered) return;
    setMovingId(item.id);
    try {
      await patchConversationUnanswered(item.id, wantUnanswered);
      toast.success("Estado atualizado.");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe conversas recebidas e organize o atendimento.
          </p>
        </div>
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            { id: "list", label: "Lista" },
            { id: "kanban", label: "Kanban" },
          ]}
        />
      </header>

      {state.status === "loading" ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar conversas...
            </p>
          </CardContent>
        </Card>
      ) : state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : state.rows.length === 0 ? (
        <Card className="ring-border">
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhuma conversa encontrada.
          </CardContent>
        </Card>
      ) : view === "list" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {state.rows.length} conversas carregadas.
          </p>
          <ul className="space-y-3">
            {state.rows.map((c) => (
              <li key={c.id}>
                <Link to={`/inbox/${c.id}`} className="block">
                  <Card className="ring-border transition-colors hover:bg-muted/20">
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <CardTitle className="font-mono text-base text-primary">
                            {c.wa_id}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {c.last_message_preview ?? "Sem mensagem recente."}
                          </CardDescription>
                        </div>
                        <Badge
                          variant={c.unanswered ? "destructive" : "secondary"}
                        >
                          {c.unanswered ? "Sem resposta" : "Respondida"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        Ultima atividade em{" "}
                        {new Date(c.last_activity_at).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <KanbanBoard<ConversationRow>
          columns={CONV_COLUMNS}
          items={state.rows}
          getColumnId={conversationColumnId}
          disabled={movingId !== null}
          onMove={handleKanbanMove}
          ariaLabel="Kanban de conversas por estado"
          getMoveOptions={() =>
            Object.entries(conversationStatusLabels).map(([id, title]) => ({
              id,
              title,
            }))
          }
          renderColumnSummary={({ column, items }) =>
            column.id === "unanswered" ? (
              <>
                <Badge variant="destructive">{items.length} pendentes</Badge>
                <Badge variant="outline">
                  {items.filter((item) => !item.assigned_user_id).length} sem responsavel
                </Badge>
              </>
            ) : (
              <>
                <Badge variant="secondary">{items.length} em dia</Badge>
                <Badge variant="outline">
                  {items.filter((item) => item.assigned_user_id).length} com responsavel
                </Badge>
              </>
            )
          }
          renderCard={(c) => (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={c.unanswered ? "destructive" : "secondary"}>
                  {c.unanswered ? "Responder" : "Em dia"}
                </Badge>
                {c.assigned_user_id ? (
                  <Badge variant="outline">Com responsavel</Badge>
                ) : (
                  <Badge variant="outline">Sem responsavel</Badge>
                )}
              </div>
              <Link
                to={`/inbox/${c.id}`}
                className="block hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="font-mono text-sm text-primary">{c.wa_id}</p>
                <p className="mt-1 line-clamp-2 text-sm text-foreground/90">
                  {c.last_message_preview ?? "Sem mensagem recente."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(c.last_activity_at).toLocaleString()}
                </p>
              </Link>
            </div>
          )}
        />
      )}
    </div>
  );
}
