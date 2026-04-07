import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { LeadCreateForm } from "@/components/lead-create-form";
import { KanbanBoard, type KanbanColumnDef } from "@/components/KanbanBoard";
import { ViewToggle } from "@/components/view-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { leadStatusLabels, labelForStatus } from "@/lib/domain-labels";
import { formatCurrencyBRL, formatDays } from "@/lib/formatters";
import { cn } from "@/lib/utils";

import {
  type LeadListItem,
  deleteLead,
  fetchLeads,
  fetchMe,
  patchLeadStatus,
} from "../api";

const SEARCH_DEBOUNCE_MS = 350;
const ARCHIVED_CLIENT = "archived_client";

const LEAD_COLUMNS: KanbanColumnDef[] = [
  {
    id: "new",
    title: leadStatusLabels.new,
    description: "Entrada no funil",
    className: "border-sky-200/80 bg-[linear-gradient(180deg,rgba(239,246,255,0.98),rgba(248,252,255,0.92))]",
  },
  {
    id: "contacted",
    title: leadStatusLabels.contacted,
    description: "Em conversa",
    className: "border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,251,235,0.98),rgba(255,253,245,0.92))]",
  },
  {
    id: "qualified",
    title: leadStatusLabels.qualified,
    description: "Prontos para avancar",
    className: "border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(249,255,252,0.92))]",
  },
  {
    id: "lost",
    title: leadStatusLabels.lost,
    description: "Rever abordagem",
    className: "border-rose-200/80 bg-[linear-gradient(180deg,rgba(255,241,242,0.98),rgba(255,249,249,0.92))]",
  },
  {
    id: ARCHIVED_CLIENT,
    title: leadStatusLabels.archived_client,
    description: "Historico",
    className: "border-zinc-200/80 bg-[linear-gradient(180deg,rgba(244,244,245,0.98),rgba(250,250,250,0.92))]",
  },
];

export function LeadsPage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; items: LeadListItem[]; total: number }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [canDeleteLead, setCanDeleteLead] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    fetchMe()
      .then((me) =>
        setCanDeleteLead(
          me.permissions.includes("leads.delete") || me.role === "admin",
        ),
      )
      .catch(() => setCanDeleteLead(false));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchQ(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(() => {
    setState({ status: "loading" });
    const isKanban = view === "kanban";
    fetchLeads({
      limit: isKanban ? 200 : 100,
      ...(isKanban || !statusFilter || statusFilter === "all"
        ? {}
        : { status: statusFilter }),
      ...(searchQ ? { q: searchQ } : {}),
    })
      .then((r) => setState({ status: "ok", items: r.items, total: r.total }))
      .catch((err: unknown) =>
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [statusFilter, searchQ, view]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleKanbanMove(
    item: LeadListItem,
    toColumnId: string,
  ): Promise<void> {
    if (item.status === toColumnId) return;
    if (toColumnId === ARCHIVED_CLIENT) {
      toast.error(
        "Esse status so e definido ao arquivar o cliente na ficha do cliente.",
      );
      return;
    }
    setMovingId(item.id);
    try {
      await patchLeadStatus(item.id, toColumnId);
      toast.success("Status do lead atualizado.");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMovingId(null);
    }
  }

  async function onConfirmDeleteFromList() {
    if (!deleteConfirmId) return;
    setDeleteBusy(true);
    try {
      await deleteLead(deleteConfirmId);
      toast.success("Lead excluido.");
      setDeleteConfirmId(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Central de oportunidades captadas manualmente e via atendimento.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle
            value={view}
            onChange={setView}
            options={[
              { id: "list", label: "Lista" },
              { id: "kanban", label: "Kanban" },
            ]}
          />
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Novo lead
          </Button>
        </div>
      </header>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Novo lead</SheetTitle>
            <SheetDescription>
              Preencha os dados abaixo ou abra a{" "}
              <Link
                to="/leads/new"
                className="text-primary underline"
                onClick={() => setCreateOpen(false)}
              >
                pagina completa
              </Link>
              .
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 px-4 pb-6">
            <LeadCreateForm
              onSuccess={(id) => {
                setCreateOpen(false);
                navigate(`/leads/${id}`);
              }}
              onCancel={() => setCreateOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && !deleteBusy && setDeleteConfirmId(null)}
      >
        <SheetContent side="bottom" className="max-h-[min(90vh,24rem)]">
          <SheetHeader>
            <SheetTitle>Excluir lead</SheetTitle>
            <SheetDescription>
              Essa acao remove o lead e os dados associados. Se houver cliente,
              ele tambem sera removido.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => void onConfirmDeleteFromList()}
            >
              {deleteBusy ? "Excluindo..." : "Confirmar exclusao"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deleteBusy}
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancelar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="lead-search">
            Pesquisar por nome, email, cidade, WhatsApp ou notas
          </Label>
          <Input
            id="lead-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Ex.: Maria ou 351..."
            autoComplete="off"
            className="min-w-[12rem]"
          />
        </div>
        <div
          className={cn(
            "space-y-2",
            view === "kanban" && "pointer-events-none opacity-50",
          )}
        >
          <Label htmlFor="lead-status">Status</Label>
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
            disabled={view === "kanban"}
          >
            <SelectTrigger id="lead-status" className="min-w-[10rem]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="new">{leadStatusLabels.new}</SelectItem>
              <SelectItem value="contacted">
                {leadStatusLabels.contacted}
              </SelectItem>
              <SelectItem value="qualified">
                {leadStatusLabels.qualified}
              </SelectItem>
              <SelectItem value="lost">{leadStatusLabels.lost}</SelectItem>
              <SelectItem value={ARCHIVED_CLIENT}>
                {leadStatusLabels.archived_client}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {state.status === "ok" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Valor potencial
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {formatCurrencyBRL(
                state.items.reduce(
                  (sum, item) => sum + (item.potential_value ?? 0),
                  0,
                ),
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Permanencia media
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {formatDays(
                state.items.length > 0
                  ? state.items.reduce(
                      (sum, item) => sum + item.current_status_days,
                      0,
                    ) / state.items.length
                  : 0,
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Ticket medio
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {formatCurrencyBRL(
                state.items.length > 0
                  ? state.items.reduce(
                      (sum, item) => sum + (item.potential_value ?? 0),
                      0,
                    ) / state.items.length
                  : 0,
              )}
            </p>
          </div>
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p className="text-muted-foreground">A carregar...</p>
      ) : state.status === "error" ? (
        <p className="text-destructive">{state.message}</p>
      ) : state.items.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 p-8 text-center text-muted-foreground">
          Nenhum lead encontrado.
        </p>
      ) : view === "list" ? (
        <>
          <p className="text-sm text-muted-foreground">Total: {state.total}</p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {state.items.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50"
              >
                <Link to={`/leads/${l.id}`} className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-primary">
                    {l.display_name?.trim() || l.wa_id || "-"}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {l.wa_id ? `WhatsApp: ${l.wa_id}` : "Sem WhatsApp"} · {l.source}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCurrencyBRL(l.potential_value)} · {formatDays(l.current_status_days)} no status
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">
                    {labelForStatus(l.status, leadStatusLabels)}
                  </Badge>
                  {canDeleteLead ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title="Excluir lead"
                      aria-label="Excluir lead"
                      onClick={() => setDeleteConfirmId(l.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <KanbanBoard<LeadListItem>
          columns={LEAD_COLUMNS}
          items={state.items}
          getColumnId={(l) => l.status}
          disabled={movingId !== null}
          onMove={handleKanbanMove}
          ariaLabel="Kanban de leads por status"
          getMoveOptions={() =>
            Object.entries(leadStatusLabels).map(([id, title]) => ({
              id,
              title,
            }))
          }
          renderColumnSummary={({ column, items }) => (
            <>
              <Badge variant="secondary">{items.length} leads</Badge>
              <Badge variant="outline">
                {formatCurrencyBRL(
                  items.reduce(
                    (sum, item) => sum + (item.potential_value ?? 0),
                    0,
                  ),
                )}
              </Badge>
              <Badge variant="outline">
                {formatDays(
                  items.length > 0
                    ? items.reduce(
                        (sum, item) => sum + item.current_status_days,
                        0,
                      ) / items.length
                    : 0,
                )} medio
              </Badge>
              {column.id === "qualified" ? (
                <Badge variant="outline">Prontos para converter</Badge>
              ) : null}
              {column.id === "new" ? (
                <Badge variant="outline">Entrada do funil</Badge>
              ) : null}
              {column.id === "lost" ? (
                <Badge variant="outline">Pede revisao</Badge>
              ) : null}
            </>
          )}
          renderCard={(l) => (
            <div className="space-y-3">
              <div className="flex items-start gap-1">
                <Link
                  to={`/leads/${l.id}`}
                  className="min-w-0 flex-1 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm font-medium text-primary">
                    {l.display_name?.trim() || l.wa_id || "-"}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {l.wa_id ? `WhatsApp: ${l.wa_id}` : "Sem WhatsApp"} ·{" "}
                    {l.source}
                  </p>
                </Link>
                {canDeleteLead ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10"
                    title="Excluir lead"
                    aria-label="Excluir lead"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmId(l.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {labelForStatus(l.status, leadStatusLabels)}
                </Badge>
                <Badge variant="outline">{l.source}</Badge>
                <Badge variant="outline">
                  {formatCurrencyBRL(l.potential_value)}
                </Badge>
                <Badge variant="outline">
                  {new Date(l.updated_at).toLocaleDateString()}
                </Badge>
                <Badge variant="outline">
                  {formatDays(l.current_status_days)} no status
                </Badge>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
