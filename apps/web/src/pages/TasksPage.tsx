import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelForStatus, taskStatusLabels } from "@/lib/domain-labels";
import { ViewToggle } from "@/components/view-toggle";

import { type TaskRow, fetchTasksMine, patchTask } from "../api";
import {
  ContextTag,
  IdLinksTask,
  taskContext,
} from "../components/EntityContextBadges";
import { KanbanBoard, type KanbanColumnDef } from "../components/KanbanBoard";

const TASK_COLUMNS: KanbanColumnDef[] = [
  {
    id: "open",
    title: taskStatusLabels.open,
    description: "Em andamento",
    className: "border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,251,235,0.98),rgba(255,253,245,0.92))]",
  },
  {
    id: "done",
    title: taskStatusLabels.done,
    description: "Concluidas",
    className: "border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(249,255,252,0.92))]",
  },
];

type TaskCtxFilter = "all" | "client" | "lead" | "conversation" | "none";

export function TasksPage() {
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [statusFilter, setStatusFilter] = useState("");
  const [ctxFilter, setCtxFilter] = useState<TaskCtxFilter>("all");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; items: TaskRow[]; total: number }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    const statusParam =
      view === "list" && (statusFilter === "open" || statusFilter === "done")
        ? statusFilter
        : undefined;
    fetchTasksMine(statusParam ? { status: statusParam } : undefined)
      .then((r) => setState({ status: "ok", items: r.items, total: r.total }))
      .catch((err: unknown) =>
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [view, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => {
    if (state.status !== "ok") return [];
    if (ctxFilter === "all") return state.items;
    return state.items.filter((t) => taskContext(t) === ctxFilter);
  }, [state, ctxFilter]);

  async function handleKanbanMove(item: TaskRow, toColumnId: string) {
    if (item.status === toColumnId) return;
    setMovingId(item.id);
    try {
      await patchTask(item.id, { status: toColumnId });
      toast.success("Status da tarefa atualizado.");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMovingId(null);
    }
  }

  function tagKind(t: TaskRow): "client" | "lead" | "conversation" | "none" {
    return taskContext(t);
  }

  function taskTimingBadge(t: TaskRow) {
    if (t.status === "done") {
      return <Badge variant="secondary">Concluida</Badge>;
    }
    if (!t.due_at) {
      return <Badge variant="outline">Sem prazo</Badge>;
    }
    const due = new Date(t.due_at).getTime();
    const now = Date.now();
    const diff = due - now;
    const oneDay = 24 * 60 * 60 * 1000;
    if (diff < 0) {
      return <Badge variant="destructive">Atrasada</Badge>;
    }
    if (diff <= oneDay) {
      return <Badge variant="secondary">Hoje</Badge>;
    }
    return <Badge variant="outline">Planejada</Badge>;
  }

  function isTaskOverdue(t: TaskRow) {
    return Boolean(t.due_at) && new Date(t.due_at as string).getTime() < Date.now() && t.status !== "done";
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tarefas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe suas tarefas de acompanhamento e execucao.
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

      <Card className="ring-border">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>
            Refine a lista por contexto e status.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="task-context">Contexto</Label>
            <Select
              value={ctxFilter}
              onValueChange={(value) => setCtxFilter(value as TaskCtxFilter)}
            >
              <SelectTrigger id="task-context" className="min-w-[12rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="conversation">Conversa</SelectItem>
                <SelectItem value="none">Sem vinculo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className={`space-y-2 ${view === "kanban" ? "pointer-events-none opacity-50" : ""}`}
          >
            <Label htmlFor="task-status">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              disabled={view === "kanban"}
            >
              <SelectTrigger id="task-status" className="min-w-[12rem]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">{taskStatusLabels.open}</SelectItem>
                <SelectItem value="done">{taskStatusLabels.done}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {state.status === "loading" ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar tarefas...
            </p>
          </CardContent>
        </Card>
      ) : state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : state.items.length === 0 ? (
        <Card className="ring-border">
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhuma tarefa atribuida a voce.
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card className="ring-border">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma tarefa corresponde aos filtros atuais. Total carregado:{" "}
            {state.total}.
          </CardContent>
        </Card>
      ) : view === "list" ? (
        <>
          <p className="text-sm text-muted-foreground">
            A mostrar {filteredItems.length} de {state.total} tarefas.
          </p>
          <ul className="space-y-3">
            {filteredItems.map((t) => (
              <li
                key={t.id}
                className="rounded-xl border border-border bg-card p-4 shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-foreground">{t.title}</p>
                  <ContextTag kind={tagKind(t)} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground/90">Status:</span>{" "}
                  {labelForStatus(t.status, taskStatusLabels)}
                  {t.due_at ? (
                    <>
                      {" · "}
                      <span className="font-medium text-foreground/90">Prazo:</span>{" "}
                      {new Date(t.due_at).toLocaleString()}
                    </>
                  ) : (
                    " · Sem prazo"
                  )}
                  {t.completed_at ? (
                    <>
                      {" · "}
                      <span className="font-medium text-foreground/90">
                        Concluida:
                      </span>{" "}
                      {new Date(t.completed_at).toLocaleString()}
                    </>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Origem: {t.source ?? "-"} ·{" "}
                  {t.assigned_user_id ? "Atribuida" : "Sem responsavel"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Criada em {new Date(t.created_at).toLocaleString()} · Atualizada
                  em {new Date(t.updated_at).toLocaleString()}
                </p>
                <IdLinksTask t={t} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <KanbanBoard<TaskRow>
          columns={TASK_COLUMNS}
          items={filteredItems}
          getColumnId={(t) => t.status}
          disabled={movingId !== null}
          onMove={handleKanbanMove}
          ariaLabel="Kanban de tarefas por estado"
          getMoveOptions={() =>
            Object.entries(taskStatusLabels).map(([id, title]) => ({
              id,
              title,
            }))
          }
          renderColumnSummary={({ column, items }) => (
            <>
              <Badge variant="secondary">{items.length} tarefas</Badge>
              <Badge variant={column.id === "done" ? "secondary" : "outline"}>
                {items.filter((item) => isTaskOverdue(item)).length} atrasadas
              </Badge>
              <Badge variant="outline">
                {items.filter((item) => !item.assigned_user_id).length} sem responsavel
              </Badge>
            </>
          )}
          renderCard={(t) => (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ContextTag kind={tagKind(t)} />
                {taskTimingBadge(t)}
              </div>
              <p className="font-medium text-foreground">{t.title}</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{t.due_at ? new Date(t.due_at).toLocaleString() : "Sem prazo"}</p>
                <p>{t.assigned_user_id ? "Atribuida" : "Sem responsavel"}</p>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
