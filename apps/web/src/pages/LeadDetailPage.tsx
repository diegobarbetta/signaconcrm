import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuthSession } from "@/auth/AuthSession";
import { CurrencyInput } from "@/components/CurrencyInput";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  demandStatusLabels,
  leadStatusLabels,
  labelForStatus,
  taskStatusLabels,
} from "@/lib/domain-labels";
import {
  currencyInputToNumber,
  numberToCurrencyInput,
} from "@/lib/currency-input";
import { formatCurrencyBRL, formatDays } from "@/lib/formatters";

import {
  convertLead,
  createDemand,
  createTask,
  deleteDemand,
  deleteLead,
  deleteTask,
  fetchDemands,
  fetchLead,
  fetchTasksForLead,
  patchLeadProfile,
  patchLeadStatus,
  postLeadNote,
  type DemandRow,
  type LeadDetail,
  type TaskRow,
} from "../api";

const PIPELINE = ["new", "contacted", "qualified", "lost"] as const;

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuthSession();
  const [state, setState] = useState<{
    status: "loading" | "error" | "ok";
    data?: LeadDetail;
    message?: string;
  }>({ status: "loading" });
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [demands, setDemands] = useState<DemandRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    display_name: "",
    city: "",
    email: "",
    phone_secondary: "",
    potential_value: "",
  });
  const [note, setNote] = useState("");
  const [leadStatus, setLeadStatus] = useState("new");
  const [dmTitle, setDmTitle] = useState("");
  const [dmDue, setDmDue] = useState("");
  const [tkTitle, setTkTitle] = useState("");
  const [tkDue, setTkDue] = useState("");
  const [confirmLeadDeleteOpen, setConfirmLeadDeleteOpen] = useState(false);
  const [pendingDemandDelete, setPendingDemandDelete] =
    useState<DemandRow | null>(null);
  const [pendingTaskDelete, setPendingTaskDelete] = useState<TaskRow | null>(
    null,
  );

  const canProfile = hasPermission("leads.update_profile");
  const canStatus = hasPermission("leads.update_status");
  const canConvert = hasPermission("leads.convert");
  const canDelete = hasPermission("leads.delete");
  const canCreateDemand = hasPermission("demands.create");
  const canCreateTask = hasPermission("tasks.create");
  const canDeleteDemand = hasPermission("demands.update");
  const canDeleteTask = hasPermission("tasks.update");

  const load = useCallback(async () => {
    if (!id) return;
    setState({ status: "loading" });
    try {
      const data = await fetchLead(id);
      setState({ status: "ok", data });
      setProfile({
        display_name: data.display_name ?? "",
        city: data.city ?? "",
        email: data.email ?? "",
        phone_secondary: data.phone_secondary ?? "",
        potential_value: numberToCurrencyInput(data.potential_value),
      });
      setLeadStatus(
        PIPELINE.includes(data.status as (typeof PIPELINE)[number])
          ? data.status
          : "new",
      );
      const [taskRes, demandRes] = await Promise.all([
        fetchTasksForLead(id),
        fetchDemands({ lead_id: id, limit: 80 }),
      ]);
      setTasks(taskRes.items);
      setDemands(demandRes.items);
    } catch (err: unknown) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile() {
    if (!id || !canProfile) return;
    setBusy(true);
    setMsg(null);
    try {
      await patchLeadProfile(id, {
        display_name: profile.display_name,
        city: profile.city,
        email: profile.email,
        phone_secondary: profile.phone_secondary,
        potential_value: currencyInputToNumber(profile.potential_value),
      });
      setMsg("Perfil atualizado.");
      await load();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveStatus() {
    if (!id || !canStatus) return;
    setBusy(true);
    setMsg(null);
    try {
      await patchLeadStatus(id, leadStatus);
      setMsg("Status atualizado.");
      await load();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!id || !note.trim() || !canProfile) return;
    setBusy(true);
    setMsg(null);
    try {
      await postLeadNote(id, note.trim());
      setNote("");
      setMsg("Nota adicionada.");
      await load();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addDemand(e: FormEvent) {
    e.preventDefault();
    if (!id || !dmTitle.trim() || !dmDue || !canCreateDemand) return;
    setBusy(true);
    try {
      await createDemand({
        title: dmTitle.trim(),
        due_at: new Date(dmDue).toISOString(),
        status: "open",
        lead_id: id,
      });
      setDmTitle("");
      setDmDue("");
      await load();
      toast.success("Demanda criada.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (!id || !tkTitle.trim() || !canCreateTask) return;
    setBusy(true);
    try {
      await createTask({
        title: tkTitle.trim(),
        status: "open",
        lead_id: id,
        ...(tkDue ? { due_at: new Date(tkDue).toISOString() } : {}),
      });
      setTkTitle("");
      setTkDue("");
      await load();
      toast.success("Tarefa criada.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runConvert() {
    if (!id || !canConvert) return;
    setBusy(true);
    try {
      const res = await convertLead(id);
      toast.success("Lead convertido em cliente.");
      navigate(`/clients/${res.client_id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    if (!id || !canDelete) return;
    setBusy(true);
    try {
      await deleteLead(id);
      toast.success("Lead eliminado.");
      setConfirmLeadDeleteOpen(false);
      navigate("/leads");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runDeleteDemand() {
    if (!pendingDemandDelete || !canDeleteDemand) return;
    setBusy(true);
    try {
      await deleteDemand(pendingDemandDelete.id);
      toast.success("Demanda eliminada.");
      setPendingDemandDelete(null);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runDeleteTask() {
    if (!pendingTaskDelete || !canDeleteTask) return;
    setBusy(true);
    try {
      await deleteTask(pendingTaskDelete.id);
      toast.success("Tarefa eliminada.");
      setPendingTaskDelete(null);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <p className="text-destructive">Lead invalido.</p>;
  if (state.status === "loading") return <p className="text-muted-foreground">A carregar...</p>;
  if (state.status === "error" || !state.data) {
    return <p className="text-destructive">{state.message}</p>;
  }

  const lead = state.data;

  return (
    <div className="space-y-6">
      <p>
        <Link to="/leads" className="text-sm text-primary hover:underline">
          {"<-"} Leads
        </Link>
      </p>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Lead Â·{" "}
            <span className="text-lg text-primary">
              {lead.display_name?.trim() || lead.wa_id || "-"}
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {lead.source} Â· {labelForStatus(lead.status, leadStatusLabels)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              {formatCurrencyBRL(lead.potential_value)}
            </span>
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              {formatDays(lead.current_status_days)} no status atual
            </span>
          </div>
        </div>
        {canDelete ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/50 text-destructive"
            disabled={busy}
            onClick={() => setConfirmLeadDeleteOpen(true)}
          >
            Eliminar lead
          </Button>
        ) : null}
      </header>

      {lead.client_id ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          Este lead ja foi convertido em cliente. Continue na{" "}
          <Link to={`/clients/${lead.client_id}`} className="text-primary underline">
            ficha do cliente
          </Link>
          .
        </div>
      ) : null}

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList variant="line">
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="relationship">Relacionamento</TabsTrigger>
          <TabsTrigger value="execution">Execucao</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card className="ring-border">
            <CardHeader>
              <CardTitle>Perfil</CardTitle>
              <CardDescription>
                Atualize os principais dados de contacto e contexto deste lead.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={profile.display_name}
                  onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
                  disabled={busy || !canProfile}
                  placeholder="Nome"
                  className="sm:col-span-2"
                />
                <Input
                  value={profile.city}
                  onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                  disabled={busy || !canProfile}
                  placeholder="Cidade"
                />
                <Input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  disabled={busy || !canProfile}
                  placeholder="Email"
                />
                <Input
                  value={profile.phone_secondary}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, phone_secondary: e.target.value }))
                  }
                  disabled={busy || !canProfile}
                  placeholder="Telefone secundario"
                  className="sm:col-span-2"
                />
                <CurrencyInput
                  value={profile.potential_value}
                  onValueChange={(value) =>
                    setProfile((p) => ({ ...p, potential_value: value }))
                  }
                  disabled={busy || !canProfile}
                  placeholder="Valor potencial"
                  className="sm:col-span-2"
                />
              </div>
              {canProfile ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveProfile()}>
                  Guardar perfil
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="relationship" className="space-y-6">
          <Card className="ring-border">
            <CardHeader>
              <CardTitle>Notas</CardTitle>
              <CardDescription>
                Registe historico de contexto para o proximo atendimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {lead.note_entries.map((n) => (
                  <div key={n.id} className="rounded border border-border/80 p-3 text-sm">
                    <p>{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
                {lead.note_entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ainda sem notas.</p>
                ) : null}
              </div>
              <form onSubmit={(e) => void addNote(e)} className="flex flex-col gap-2 sm:flex-row">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy || !canProfile}
                  rows={2}
                  className="flex-1"
                  placeholder="Nova nota..."
                />
                {canProfile ? (
                  <Button type="submit" variant="secondary" disabled={busy || !note.trim()}>
                    Adicionar nota
                  </Button>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <Card className="ring-border">
            <CardHeader>
              <CardTitle>Operacoes</CardTitle>
              <CardDescription>
                Ajuste a etapa do funil e execute acoes disponiveis para este lead.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                {canStatus ? (
                  <>
                    <div className="min-w-56 space-y-2">
                      <Label htmlFor="lead-status">Etapa do lead</Label>
                      <Select value={leadStatus} onValueChange={setLeadStatus} disabled={busy}>
                        <SelectTrigger id="lead-status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PIPELINE.map((s) => (
                            <SelectItem key={s} value={s}>
                              {leadStatusLabels[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveStatus()}>
                      Guardar status
                    </Button>
                  </>
                ) : null}
                {canConvert ? (
                  <Button
                    type="button"
                    disabled={busy || lead.status !== "qualified" || Boolean(lead.client_id)}
                    onClick={() => void runConvert()}
                  >
                    Converter em cliente
                  </Button>
                ) : null}
              </div>
              {msg ? (
                <Alert>
                  <AlertDescription>{msg}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="execution">
          <Tabs defaultValue="demands" className="space-y-4">
            <TabsList variant="line">
              <TabsTrigger value="demands">Demandas</TabsTrigger>
              <TabsTrigger value="tasks">Tarefas</TabsTrigger>
            </TabsList>

            <TabsContent value="demands">
              <Card className="ring-border">
                <CardHeader>
                  <CardTitle>Demandas</CardTitle>
                  <CardDescription>
                    Transforme necessidades em entregas com prazo definido.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {demands.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-start justify-between gap-3 rounded border border-border/80 p-3 text-sm"
                    >
                      <div>
                        {d.title}{" "}
                        <span className="text-muted-foreground">
                          Â· {labelForStatus(d.status, demandStatusLabels)}
                        </span>
                      </div>
                      {canDeleteDemand ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={busy}
                          onClick={() => setPendingDemandDelete(d)}
                        >
                          Eliminar
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {demands.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma demanda.</p>
                  ) : null}
                  {canCreateDemand ? (
                    <form onSubmit={(e) => void addDemand(e)} className="space-y-2">
                      <div className="space-y-2">
                        <Label htmlFor="lead-demand-title">Titulo da demanda</Label>
                        <Input
                          id="lead-demand-title"
                          value={dmTitle}
                          onChange={(e) => setDmTitle(e.target.value)}
                          placeholder="Ex.: Revisar proposta"
                          disabled={busy}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lead-demand-due">Prazo</Label>
                        <Input
                          id="lead-demand-due"
                          type="datetime-local"
                          value={dmDue}
                          onChange={(e) => setDmDue(e.target.value)}
                          disabled={busy}
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={busy || !dmTitle.trim() || !dmDue}
                      >
                        Criar demanda
                      </Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tasks">
              <Card className="ring-border">
                <CardHeader>
                  <CardTitle>Tarefas</CardTitle>
                  <CardDescription>
                    Registe proximos passos leves para manter o relacionamento em movimento.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-start justify-between gap-3 rounded border border-border/80 p-3 text-sm"
                    >
                      <div>
                        {t.title}{" "}
                        <span className="text-muted-foreground">
                          Â· {labelForStatus(t.status, taskStatusLabels)}
                        </span>
                      </div>
                      {canDeleteTask ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={busy}
                          onClick={() => setPendingTaskDelete(t)}
                        >
                          Eliminar
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {tasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma tarefa.</p>
                  ) : null}
                  {canCreateTask ? (
                    <form onSubmit={(e) => void addTask(e)} className="space-y-2">
                      <div className="space-y-2">
                        <Label htmlFor="lead-task-title">Titulo da tarefa</Label>
                        <Input
                          id="lead-task-title"
                          value={tkTitle}
                          onChange={(e) => setTkTitle(e.target.value)}
                          placeholder="Ex.: Agendar retorno"
                          disabled={busy}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lead-task-due">Prazo (opcional)</Label>
                        <Input
                          id="lead-task-due"
                          type="datetime-local"
                          value={tkDue}
                          onChange={(e) => setTkDue(e.target.value)}
                          disabled={busy}
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={busy || !tkTitle.trim()}
                      >
                        Criar tarefa
                      </Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmLeadDeleteOpen}
        onOpenChange={setConfirmLeadDeleteOpen}
        title="Eliminar lead?"
        description="Esta ação remove o lead e também apaga tarefas, demandas e relações diretas vinculadas a ele."
        confirmLabel="Eliminar lead"
        onConfirm={runDelete}
        loading={busy}
      />

      <ConfirmDialog
        open={pendingDemandDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDemandDelete(null);
        }}
        title="Eliminar demanda?"
        description="A demanda será removida em definitivo, junto das tarefas diretamente vinculadas a ela."
        confirmLabel="Eliminar demanda"
        onConfirm={runDeleteDemand}
        loading={busy}
      />

      <ConfirmDialog
        open={pendingTaskDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTaskDelete(null);
        }}
        title="Eliminar tarefa?"
        description="A tarefa será removida em definitivo após a confirmação."
        confirmLabel="Eliminar tarefa"
        onConfirm={runDeleteTask}
        loading={busy}
      />
    </div>
  );
}
