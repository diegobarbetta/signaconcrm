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
  labelForStatus,
  taskStatusLabels,
} from "@/lib/domain-labels";
import {
  currencyInputToNumber,
  numberToCurrencyInput,
} from "@/lib/currency-input";
import { formatCurrencyBRL } from "@/lib/formatters";

import {
  archiveClient,
  createClientService,
  createDemand,
  createTask,
  deleteClient,
  deleteDemand,
  deleteTask,
  fetchClient,
  fetchDemands,
  fetchTasksForClient,
  patchClient,
  type ClientDetail,
  type DemandRow,
  type TaskRow,
} from "../api";

const SERVICE_STATUSES = ["active", "paused", "ended"] as const;

const serviceStatusLabels: Record<(typeof SERVICE_STATUSES)[number], string> = {
  active: "Ativo",
  paused: "Pausado",
  ended: "Encerrado",
};

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuthSession();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [demands, setDemands] = useState<DemandRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svcName, setSvcName] = useState("");
  const [svcStatus, setSvcStatus] = useState<string>("active");
  const [svcAmount, setSvcAmount] = useState("");
  const [svcRenews, setSvcRenews] = useState("");
  const [dTitle, setDTitle] = useState("");
  const [dDue, setDDue] = useState("");
  const [tTitle, setTTitle] = useState("");
  const [tDue, setTDue] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [deleteClientConfirmOpen, setDeleteClientConfirmOpen] = useState(false);
  const [pendingDemandDelete, setPendingDemandDelete] =
    useState<DemandRow | null>(null);
  const [pendingTaskDelete, setPendingTaskDelete] = useState<TaskRow | null>(
    null,
  );
  const [clientProfile, setClientProfile] = useState({
    display_name: "",
    notes: "",
    reference_value: "",
  });

  const canManageClients = hasPermission("clients.manage");
  const canCreateDemand = hasPermission("demands.create");
  const canCreateTask = hasPermission("tasks.create");
  const canDeleteDemand = hasPermission("demands.update");
  const canDeleteTask = hasPermission("tasks.update");

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await fetchClient(id);
      setClient(data);
      setClientProfile({
        display_name: data.display_name ?? "",
        notes: data.notes ?? "",
        reference_value: numberToCurrencyInput(data.reference_value),
      });
      const [d, t] = await Promise.all([
        fetchDemands({ client_id: id, limit: 50 }),
        fetchTasksForClient(id, 50),
      ]);
      setDemands(d.items);
      setTasks(t.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addService(e: FormEvent) {
    e.preventDefault();
    if (!id || !svcName.trim() || !canManageClients) return;
    setBusy(true);
    try {
      await createClientService(id, {
        name: svcName.trim(),
        status: svcStatus,
        amount: currencyInputToNumber(svcAmount) ?? 0,
        ...(svcRenews ? { renews_at: new Date(svcRenews).toISOString() } : {}),
      });
      setSvcName("");
      setSvcAmount("");
      setSvcRenews("");
      await load();
      toast.success("Servico adicionado.");
    } finally {
      setBusy(false);
    }
  }

  async function saveClientProfile(e: FormEvent) {
    e.preventDefault();
    if (!client || !canManageClients) return;
    setBusy(true);
    try {
      await patchClient(client.id, {
        display_name: clientProfile.display_name.trim() || null,
        notes: clientProfile.notes.trim() || null,
        reference_value: currencyInputToNumber(clientProfile.reference_value),
      });
      await load();
      toast.success("Cliente atualizado.");
    } finally {
      setBusy(false);
    }
  }

  async function addDemand(e: FormEvent) {
    e.preventDefault();
    if (!id || !dTitle.trim() || !dDue || !canCreateDemand) return;
    setBusy(true);
    try {
      await createDemand({
        title: dTitle.trim(),
        due_at: new Date(dDue).toISOString(),
        status: "open",
        client_id: id,
      });
      setDTitle("");
      setDDue("");
      await load();
      toast.success("Demanda criada.");
    } finally {
      setBusy(false);
    }
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (!client || !tTitle.trim() || !canCreateTask) return;
    setBusy(true);
    try {
      await createTask({
        title: tTitle.trim(),
        status: "open",
        client_id: client.id,
        ...(tDue ? { due_at: new Date(tDue).toISOString() } : {}),
      });
      setTTitle("");
      setTDue("");
      await load();
      toast.success("Tarefa criada.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveCurrentClient() {
    if (!id || archiveReason.trim().length < 10 || !canManageClients) return;
    setBusy(true);
    try {
      const res = await archiveClient(id, { reason: archiveReason.trim() });
      toast.success("Cliente arquivado.");
      setArchiveConfirmOpen(false);
      navigate(`/leads/${res.lead_id}`);
    } finally {
      setBusy(false);
    }
  }

  async function runDeleteClient() {
    if (!id || !canManageClients) return;
    setBusy(true);
    try {
      await deleteClient(id);
      toast.success("Cliente eliminado.");
      setDeleteClientConfirmOpen(false);
      navigate("/clients");
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
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <p className="text-destructive">Cliente invalido.</p>;

  return (
    <div className="space-y-6">
      <p>
        <Link to="/clients" className="text-sm text-primary hover:underline">
          {"<-"} Clientes
        </Link>
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!client ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar cliente...
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                Cliente Â·{" "}
                <span className="text-lg text-primary">
                  {client.display_name?.trim() || client.wa_id}
                </span>
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-mono">{client.wa_id}</span> Â·{" "}
                <Link
                  to={`/leads/${client.lead_id}`}
                  className="text-primary hover:underline"
                >
                  Ver lead associado
                </Link>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  Referencia: {formatCurrencyBRL(client.reference_value)}
                </span>
                <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  Real: {formatCurrencyBRL(client.real_value)}
                </span>
              </div>
            </div>
            {canManageClients ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-destructive/50 text-destructive"
                disabled={busy}
                onClick={() => setDeleteClientConfirmOpen(true)}
              >
                Eliminar cliente
              </Button>
            ) : null}
          </header>

          <Tabs defaultValue="commercial" className="space-y-4">
            <TabsList variant="line">
              <TabsTrigger value="commercial">Comercial</TabsTrigger>
              <TabsTrigger value="services">Servicos</TabsTrigger>
              <TabsTrigger value="execution">Execucao</TabsTrigger>
            </TabsList>

            <TabsContent value="commercial" className="space-y-6">
              <Card className="ring-border">
                <CardHeader>
                  <CardTitle>Perfil comercial</CardTitle>
                  <CardDescription>
                    Ajuste nome, notas e o valor de referencia herdado do lead.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={(e) => void saveClientProfile(e)} className="space-y-3">
                    <Input
                      value={clientProfile.display_name}
                      onChange={(e) =>
                        setClientProfile((current) => ({
                          ...current,
                          display_name: e.target.value,
                        }))
                      }
                      disabled={busy || !canManageClients}
                      placeholder="Nome do cliente"
                    />
                    <Textarea
                      value={clientProfile.notes}
                      onChange={(e) =>
                        setClientProfile((current) => ({
                          ...current,
                          notes: e.target.value,
                        }))
                      }
                      rows={3}
                      disabled={busy || !canManageClients}
                      placeholder="Notas do cliente"
                    />
                    <CurrencyInput
                      value={clientProfile.reference_value}
                      onValueChange={(value) =>
                        setClientProfile((current) => ({
                          ...current,
                          reference_value: value,
                        }))
                      }
                      disabled={busy || !canManageClients}
                      placeholder="Valor de referencia"
                    />
                    <p className="text-xs text-muted-foreground">
                      O valor real do cliente e calculado automaticamente pela soma
                      dos servicos ativos e pausados.
                    </p>
                    {canManageClients ? (
                      <Button type="submit" variant="secondary" disabled={busy}>
                        Guardar perfil
                      </Button>
                    ) : null}
                  </form>
                </CardContent>
              </Card>

              <Card className="ring-destructive/20">
                <CardHeader>
                  <CardTitle>Arquivar cliente</CardTitle>
                  <CardDescription>
                    Use esta acao quando o relacionamento precisar voltar para a
                    etapa de lead.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={archiveReason}
                    onChange={(e) => setArchiveReason(e.target.value)}
                    rows={3}
                    placeholder="Descreva o motivo do arquivamento"
                    disabled={busy || !canManageClients}
                  />
                  {canManageClients ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || archiveReason.trim().length < 10}
                      onClick={() => setArchiveConfirmOpen(true)}
                    >
                      Arquivar e voltar para lead
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="services">
              <Card className="ring-border">
                <CardHeader>
                  <CardTitle>Servicos contratados</CardTitle>
                  <CardDescription>
                    O valor real do cliente e a soma dos servicos ativos e pausados.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {client.services.map((service) => (
                    <div key={service.id} className="rounded border border-border/80 p-3 text-sm">
                      {service.name}{" "}
                      <span className="text-muted-foreground">
                        Â·{" "}
                        {serviceStatusLabels[
                          service.status as keyof typeof serviceStatusLabels
                        ] ?? service.status}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}Â· {formatCurrencyBRL(service.amount)}
                      </span>
                    </div>
                  ))}
                  {client.services.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum servico registado.</p>
                  ) : null}
                  {canManageClients ? (
                    <form
                      onSubmit={(e) => void addService(e)}
                      className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_14rem_14rem_16rem_auto]"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="service-name">Nome do servico</Label>
                        <Input
                          id="service-name"
                          value={svcName}
                          onChange={(e) => setSvcName(e.target.value)}
                          placeholder="Ex.: Gestao de trafego"
                          disabled={busy}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="service-status">Estado do servico</Label>
                        <Select value={svcStatus} onValueChange={setSvcStatus} disabled={busy}>
                          <SelectTrigger id="service-status" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SERVICE_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {serviceStatusLabels[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="service-amount">Valor do servico</Label>
                        <CurrencyInput
                          id="service-amount"
                          value={svcAmount}
                          onValueChange={setSvcAmount}
                          disabled={busy}
                          placeholder="R$ 0,00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="service-renew">Renovacao (opcional)</Label>
                        <Input
                          id="service-renew"
                          type="datetime-local"
                          value={svcRenews}
                          onChange={(e) => setSvcRenews(e.target.value)}
                          disabled={busy}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="submit"
                          disabled={busy || !svcName.trim() || !svcAmount.trim()}
                          className="w-full xl:w-auto"
                        >
                          Adicionar servico
                        </Button>
                      </div>
                    </form>
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
                        Centralize pedidos em aberto e registre novas frentes de trabalho.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {demands.map((demand) => (
                        <div
                          key={demand.id}
                          className="flex items-start justify-between gap-3 rounded border border-border/80 p-3 text-sm"
                        >
                          <div>
                            {demand.title}{" "}
                            <span className="text-muted-foreground">
                              Â· {labelForStatus(demand.status, demandStatusLabels)}
                            </span>
                          </div>
                          {canDeleteDemand ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={busy}
                              onClick={() => setPendingDemandDelete(demand)}
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
                        <form onSubmit={(e) => void addDemand(e)} className="space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="client-demand-title">Titulo da demanda</Label>
                            <Input
                              id="client-demand-title"
                              value={dTitle}
                              onChange={(e) => setDTitle(e.target.value)}
                              placeholder="Ex.: Revisar contrato"
                              disabled={busy}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="client-demand-due">Prazo</Label>
                            <Input
                              id="client-demand-due"
                              type="datetime-local"
                              value={dDue}
                              onChange={(e) => setDDue(e.target.value)}
                              disabled={busy}
                            />
                          </div>
                          <Button
                            type="submit"
                            variant="secondary"
                            disabled={busy || !dTitle.trim() || !dDue}
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
                        Organize proximos passos do atendimento e acompanhe a execucao.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {tasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-start justify-between gap-3 rounded border border-border/80 p-3 text-sm"
                        >
                          <div>
                            {task.title}{" "}
                            <span className="text-muted-foreground">
                              Â· {labelForStatus(task.status, taskStatusLabels)}
                            </span>
                          </div>
                          {canDeleteTask ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={busy}
                              onClick={() => setPendingTaskDelete(task)}
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
                        <form onSubmit={(e) => void addTask(e)} className="space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="client-task-title">Titulo da tarefa</Label>
                            <Input
                              id="client-task-title"
                              value={tTitle}
                              onChange={(e) => setTTitle(e.target.value)}
                              placeholder="Ex.: Confirmar briefing"
                              disabled={busy}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="client-task-due">Prazo (opcional)</Label>
                            <Input
                              id="client-task-due"
                              type="datetime-local"
                              value={tDue}
                              onChange={(e) => setTDue(e.target.value)}
                              disabled={busy}
                            />
                          </div>
                          <Button
                            type="submit"
                            variant="secondary"
                            disabled={busy || !tTitle.trim()}
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
            open={archiveConfirmOpen}
            onOpenChange={setArchiveConfirmOpen}
            title="Arquivar cliente?"
            description="O cliente deixará de existir como cliente ativo e as demandas vinculadas voltarão para o lead relacionado."
            confirmLabel="Arquivar cliente"
            confirmVariant="outline"
            onConfirm={archiveCurrentClient}
            loading={busy}
          />

          <ConfirmDialog
            open={deleteClientConfirmOpen}
            onOpenChange={setDeleteClientConfirmOpen}
            title="Eliminar cliente?"
            description="Esta ação remove o cliente, o lead de origem, tarefas, demandas e demais relações diretas vinculadas."
            confirmLabel="Eliminar cliente"
            onConfirm={runDeleteClient}
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
        </>
      )}
    </div>
  );
}
