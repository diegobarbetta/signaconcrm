import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ViewToggle } from "@/components/view-toggle";
import { demandStatusLabels, labelForStatus } from "@/lib/domain-labels";

import { type DemandRow, createDemand, fetchDemands, patchDemand } from "../api";
import {
  ContextTag,
  IdLinksDemand,
  demandContext,
} from "../components/EntityContextBadges";
import { KanbanBoard, type KanbanColumnDef } from "../components/KanbanBoard";

const DEMAND_COLUMNS: KanbanColumnDef[] = [
  {
    id: "open",
    title: demandStatusLabels.open,
    description: "Aguardando inicio",
    className: "border-sky-200/80 bg-[linear-gradient(180deg,rgba(239,246,255,0.98),rgba(248,252,255,0.92))]",
  },
  {
    id: "in_progress",
    title: demandStatusLabels.in_progress,
    description: "Em execucao",
    className: "border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,251,235,0.98),rgba(255,253,245,0.92))]",
  },
  {
    id: "done",
    title: demandStatusLabels.done,
    description: "Concluidas",
    className: "border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(249,255,252,0.92))]",
  },
];

type DemandCtxFilter = "all" | "client" | "lead" | "none";

export function DemandsPage() {
  const [searchParams] = useSearchParams();
  const clientFilter = searchParams.get("client_id") ?? undefined;
  const leadFilter = searchParams.get("lead_id") ?? undefined;

  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [statusFilter, setStatusFilter] = useState("");
  const [ctxFilter, setCtxFilter] = useState<DemandCtxFilter>("all");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; items: DemandRow[]; total: number }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [clientId, setClientId] = useState(clientFilter ?? "");
  const [leadId, setLeadId] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetchDemands({
      limit: 150,
      ...(clientFilter ? { client_id: clientFilter } : {}),
      ...(leadFilter ? { lead_id: leadFilter } : {}),
      ...(view === "list" && statusFilter !== "" ? { status: statusFilter } : {}),
    })
      .then((r) => setState({ status: "ok", items: r.items, total: r.total }))
      .catch((err: unknown) =>
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [clientFilter, leadFilter, view, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setClientId(clientFilter ?? "");
  }, [clientFilter]);

  const filteredItems = useMemo(() => {
    if (state.status !== "ok") return [];
    if (ctxFilter === "all") return state.items;
    return state.items.filter((d) => demandContext(d) === ctxFilter);
  }, [state, ctxFilter]);

  function demandTimingBadge(d: DemandRow) {
    const due = new Date(d.due_at).getTime();
    const now = Date.now();
    const diff = due - now;
    const oneDay = 24 * 60 * 60 * 1000;
    if (diff < 0) {
      return <Badge variant="destructive">Atrasada</Badge>;
    }
    if (diff <= oneDay) {
      return <Badge variant="secondary">Vence hoje</Badge>;
    }
    return <Badge variant="outline">No prazo</Badge>;
  }

  function isDemandOverdue(d: DemandRow) {
    return new Date(d.due_at).getTime() < Date.now() && d.status !== "done";
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !due) return;
    if (clientId.trim() && leadId.trim()) {
      toast.warning("Escolha apenas um vinculo: cliente ou lead.");
      return;
    }
    try {
      await createDemand({
        title: title.trim(),
        due_at: new Date(due).toISOString(),
        status: "open",
        ...(clientId.trim()
          ? { client_id: clientId.trim() }
          : leadId.trim()
            ? { lead_id: leadId.trim() }
            : {}),
      });
      setTitle("");
      setDue("");
      setCreateSheetOpen(false);
      load();
      toast.success("Demanda criada.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleKanbanMove(item: DemandRow, toColumnId: string) {
    if (item.status === toColumnId) return;
    setMovingId(item.id);
    try {
      await patchDemand(item.id, { status: toColumnId });
      toast.success("Status da demanda atualizado.");
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
          <h1 className="text-2xl font-semibold text-foreground">Demandas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe entregas e pendencias com prazo.
            {clientFilter ? " Lista filtrada por cliente." : null}
            {leadFilter ? " Lista filtrada por lead." : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCreateSheetOpen(true)}
          >
            Nova demanda
          </Button>
          <ViewToggle
            value={view}
            onChange={setView}
            options={[
              { id: "list", label: "Lista" },
              { id: "kanban", label: "Kanban" },
            ]}
          />
        </div>
      </header>

      <Sheet open={createSheetOpen} onOpenChange={setCreateSheetOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Nova demanda</SheetTitle>
            <SheetDescription>
              Informe o titulo, o prazo e, se desejar, relacione a demanda a um
              cliente ou lead ja existente.
            </SheetDescription>
          </SheetHeader>
          <form
            onSubmit={(e) => void onCreate(e)}
            className="mt-4 space-y-3 px-4 pb-6"
          >
            <div className="space-y-2">
              <Label htmlFor="dm-title">Titulo</Label>
              <Input
                id="dm-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Revisar proposta comercial"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dm-due">Prazo</Label>
              <Input
                id="dm-due"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dm-client">Cliente relacionado (opcional)</Label>
              <Input
                id="dm-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Cole o identificador do cliente"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dm-lead">Lead relacionado (opcional)</Label>
              <Input
                id="dm-lead"
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
                placeholder="Cole o identificador do lead"
                className="font-mono text-xs"
              />
            </div>
            <Button
              type="submit"
              disabled={!title.trim() || !due}
              className="w-full sm:w-auto"
            >
              Criar demanda
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <Card className="ring-border">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>
            Refine a visualizacao por contexto e status.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="demand-context">Vinculo</Label>
            <Select
              value={ctxFilter}
              onValueChange={(value) => setCtxFilter(value as DemandCtxFilter)}
            >
              <SelectTrigger id="demand-context" className="min-w-[12rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="none">Sem vinculo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className={`space-y-2 ${view === "kanban" ? "pointer-events-none opacity-50" : ""}`}
          >
            <Label htmlFor="demand-status">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              disabled={view === "kanban"}
            >
              <SelectTrigger id="demand-status" className="min-w-[12rem]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">{demandStatusLabels.open}</SelectItem>
                <SelectItem value="in_progress">
                  {demandStatusLabels.in_progress}
                </SelectItem>
                <SelectItem value="done">{demandStatusLabels.done}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {state.status === "loading" ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar demandas...
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
            Nenhuma demanda encontrada.
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card className="ring-border">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma demanda corresponde aos filtros atuais. Total carregado:{" "}
            {state.total}.
          </CardContent>
        </Card>
      ) : view === "list" ? (
        <>
          <p className="text-sm text-muted-foreground">
            A mostrar {filteredItems.length} de {state.total} demandas.
          </p>
          <ul className="space-y-3">
            {filteredItems.map((d) => {
              const kind = demandContext(d);
              return (
                <li
                  key={d.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium text-foreground">{d.title}</p>
                    <ContextTag kind={kind === "none" ? "none" : kind} />
                  </div>
                  {d.description ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {d.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground/90">Status:</span>{" "}
                    {labelForStatus(d.status, demandStatusLabels)}
                    {" · "}
                    <span className="font-medium text-foreground/90">Prazo:</span>{" "}
                    {new Date(d.due_at).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.assigned_user_id ? "Com responsavel" : "Sem responsavel"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Criada em {new Date(d.created_at).toLocaleString()} · Atualizada
                    em {new Date(d.updated_at).toLocaleString()}
                  </p>
                  <IdLinksDemand d={d} />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <KanbanBoard<DemandRow>
          columns={DEMAND_COLUMNS}
          items={filteredItems}
          getColumnId={(d) => d.status}
          disabled={movingId !== null}
          onMove={handleKanbanMove}
          ariaLabel="Kanban de demandas por status"
          getMoveOptions={() =>
            Object.entries(demandStatusLabels).map(([id, title]) => ({
              id,
              title,
            }))
          }
          renderColumnSummary={({ column, items }) => (
            <>
              <Badge variant="secondary">{items.length} itens</Badge>
              <Badge variant={column.id === "done" ? "secondary" : "outline"}>
                {items.filter((item) => isDemandOverdue(item)).length} atrasadas
              </Badge>
              <Badge variant="outline">
                {items.filter((item) => !item.assigned_user_id).length} sem responsavel
              </Badge>
            </>
          )}
          renderCard={(d) => {
            const kind = demandContext(d);
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <ContextTag kind={kind === "none" ? "none" : kind} />
                  {demandTimingBadge(d)}
                </div>
                <p className="font-medium text-foreground">{d.title}</p>
                {d.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {d.description}
                  </p>
                ) : null}
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Prazo: {new Date(d.due_at).toLocaleString()}</p>
                  <p>{d.assigned_user_id ? "Com responsavel" : "Sem responsavel"}</p>
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
