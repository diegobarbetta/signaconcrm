import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CircleCheckBig,
  Clock3,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  demandStatusLabels,
  labelForStatus,
  leadStatusLabels,
} from "@/lib/domain-labels";
import { formatCurrencyBRL, formatDays } from "@/lib/formatters";

import {
  fetchDashboardSummary,
  healthUrl,
  type DashboardSummaryPayload,
} from "../api";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; body: string }
  | { status: "error"; message: string };

type DashState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: DashboardSummaryPayload }
  | { status: "error"; message: string };

const chartPalette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DashboardPage() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [dash, setDash] = useState<DashState>({ status: "idle" });

  useEffect(() => {
    fetch(healthUrl())
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          setHealth({
            status: "error",
            message: `${res.status}: ${text}`,
          });
          return;
        }
        setHealth({ status: "ok", body: text });
      })
      .catch((err: unknown) => {
        setHealth({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  const loadDashboard = useCallback(() => {
    setDash({ status: "loading" });
    fetchDashboardSummary({ taskPreviewLimit: 5, demandPreviewLimit: 5 })
      .then((data) => setDash({ status: "ok", data }))
      .catch((err: unknown) =>
        setDash({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const leadsChartData = useMemo(() => {
    if (dash.status !== "ok") return [];
    return Object.entries(dash.data.leads_by_status)
      .map(([name, value], index) => ({
        name,
        label: labelForStatus(name, leadStatusLabels),
        value,
        fill: chartPalette[index % chartPalette.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [dash]);

  const demandsChartData = useMemo(() => {
    if (dash.status !== "ok") return [];
    return Object.entries(dash.data.demands.by_status)
      .map(([name, value], index) => ({
        name,
        label: labelForStatus(name, demandStatusLabels),
        value,
        fill: chartPalette[index % chartPalette.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [dash]);

  const overview = useMemo(() => {
    if (dash.status !== "ok") return null;
    const totalLeads = Object.values(dash.data.leads_by_status).reduce(
      (sum, value) => sum + value,
      0,
    );
    const qualifiedLeads = dash.data.leads_by_status.qualified ?? 0;
    const newLeads = dash.data.leads_by_status.new ?? 0;
    const contactedLeads = dash.data.leads_by_status.contacted ?? 0;
    const lostLeads = dash.data.leads_by_status.lost ?? 0;
    const conversionRate =
      totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;
    const attentionLoad =
      dash.data.tasks.overdue + dash.data.demands.overdue + newLeads;

    return {
      totalLeads,
      qualifiedLeads,
      newLeads,
      contactedLeads,
      lostLeads,
      conversionRate,
      attentionLoad,
      totalPotentialValue: dash.data.lead_value.total_potential,
      totalGeneratedValue: dash.data.clients.total_generated_value,
    };
  }, [dash]);

  const topPriorities = useMemo(() => {
    if (dash.status !== "ok" || !overview) return [];

    return [
      {
        title: "Pendencias criticas",
        value: overview.attentionLoad,
        tone:
          overview.attentionLoad > 0 ? "text-destructive" : "text-foreground",
        description:
          "Soma de leads novos, tarefas atrasadas e demandas vencidas.",
      },
      {
        title: "Pipeline potencial",
        value: formatCurrencyBRL(overview.totalPotentialValue),
        tone: "text-primary",
        description: "Valor somado das oportunidades ainda ativas no funil.",
      },
      {
        title: "Receita mapeada",
        value: formatCurrencyBRL(overview.totalGeneratedValue),
        tone: "text-foreground",
        description: "Valor real calculado pela soma dos servicos ativos e pausados.",
      },
    ];
  }, [dash, overview]);

  const leadsChartConfig = {
    value: { label: "Leads", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  const demandsChartConfig = {
    value: { label: "Demandas", color: "var(--chart-3)" },
  } satisfies ChartConfig;

  const healthBadge =
    health.status === "ok"
      ? { label: "API operacional", variant: "default" as const }
      : health.status === "loading"
        ? { label: "A verificar", variant: "secondary" as const }
        : { label: "Falha na API", variant: "destructive" as const };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(224,170,57,0.20),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(246,242,235,0.92))] p-6 shadow-sm">
        <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[linear-gradient(135deg,transparent,rgba(224,170,57,0.08))] md:block" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={healthBadge.variant}>{healthBadge.label}</Badge>
              <Badge variant="outline">Painel operacional</Badge>
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Visao diaria da operacao
              </h1>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                O dashboard prioriza ritmo comercial, riscos de execucao e
                proximos passos para a equipa agir sem precisar interpretar
                endpoints ou logs.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[28rem]">
            {topPriorities.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-foreground/10 bg-white/80 p-4 backdrop-blur"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  {item.title}
                </p>
                <p className={`mt-2 text-3xl font-semibold ${item.tone}`}>
                  {item.value}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {dash.status === "ok"
            ? `Atualizado em ${formatDateTime(dash.data.generated_at)}`
            : "Aguardando dados do painel"}
        </div>
        <Button type="button" onClick={loadDashboard} className="gap-2">
          <RefreshCw className="size-4" />
          Atualizar painel
        </Button>
      </div>

      {dash.status === "loading" || dash.status === "idle" ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar indicadores da operacao...
            </p>
          </CardContent>
        </Card>
      ) : dash.status === "error" ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle>Nao foi possivel montar o dashboard</CardTitle>
            <CardDescription>
              Verifique a ligacao com a API e tente novamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{dash.message}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="ring-border">
              <CardHeader className="pb-0">
                <CardDescription>Leads no funil</CardDescription>
                <CardTitle className="flex items-center gap-2 text-3xl">
                  <Target className="size-5 text-primary" />
                  {overview?.totalLeads ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {overview?.newLeads ?? 0} novos, {overview?.contactedLeads ?? 0}{" "}
                  em contato.
                </p>
              </CardContent>
            </Card>

            <Card className="ring-border">
              <CardHeader className="pb-0">
                <CardDescription>Qualificacao</CardDescription>
                <CardTitle className="flex items-center gap-2 text-3xl">
                  <TrendingUp className="size-5 text-chart-2" />
                  {formatCurrencyBRL(dash.data.lead_value.total_potential)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {overview?.qualifiedLeads ?? 0} leads qualificados e ticket medio de{" "}
                  {formatCurrencyBRL(
                    (overview?.totalLeads ?? 0) > 0
                      ? dash.data.lead_value.total_potential / (overview?.totalLeads ?? 1)
                      : 0,
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="ring-border">
              <CardHeader className="pb-0">
                <CardDescription>Tarefas em aberto</CardDescription>
                <CardTitle className="flex items-center gap-2 text-3xl">
                  <Clock3 className="size-5 text-chart-3" />
                  {dash.data.tasks.open_total}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {dash.data.tasks.overdue} atrasadas e {dash.data.tasks.today} de
                  hoje.
                </p>
              </CardContent>
            </Card>

            <Card className="ring-border">
              <CardHeader className="pb-0">
                <CardDescription>Demandas vencidas</CardDescription>
                <CardTitle className="flex items-center gap-2 text-3xl">
                  <AlertTriangle className="size-5 text-destructive" />
                  {formatDays(
                    dash.data.lead_value.avg_days_in_status.contacted ?? 0,
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Media de permanencia em contato. {overview?.lostLeads ?? 0} leads perdidos merecem revisao de processo.
                </p>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <Card className="ring-border">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  <CardTitle>Funil de leads</CardTitle>
                </div>
                <CardDescription>
                  Distribuicao atual do pipeline para leitura rapida do ritmo
                  comercial.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Potencial total
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {formatCurrencyBRL(dash.data.lead_value.total_potential)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Valor real dos clientes
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {formatCurrencyBRL(dash.data.clients.total_generated_value)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Media em qualificacao
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {formatDays(
                        dash.data.lead_value.avg_days_in_status.qualified ?? 0,
                      )}
                    </p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {leadsChartData.map((item) => (
                    <div
                      key={item.name}
                      className="rounded-xl border border-border/70 bg-muted/30 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: item.fill }}
                        />
                        <p className="text-sm text-muted-foreground">
                          {item.label}
                        </p>
                      </div>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {item.value}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatCurrencyBRL(
                          dash.data.lead_value.by_status[item.name] ?? 0,
                        )} · {formatDays(
                          dash.data.lead_value.avg_days_in_status[item.name] ?? 0,
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                {leadsChartData.length > 0 ? (
                  <ChartContainer
                    config={leadsChartConfig}
                    className="h-[320px] w-full"
                  >
                    <BarChart
                      data={leadsChartData}
                      barCategoryGap={24}
                      accessibilityLayer
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={10}
                      />
                      <YAxis tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent />}
                      />
                      <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                        {leadsChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sem dados de leads para o periodo atual.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="ring-border">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-chart-3" />
                  <CardTitle>Saude da execucao</CardTitle>
                </div>
                <CardDescription>
                  Equilibrio entre prazos, fila de trabalho e proximos
                  vencimentos.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Em risco imediato
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-destructive">
                      {dash.data.tasks.overdue + dash.data.demands.overdue}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Itens vencidos que ja merecem resposta da equipa.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        Tarefas hoje
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {dash.data.tasks.today}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        Proximas tarefas
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {dash.data.tasks.upcoming}
                      </p>
                    </div>
                  </div>
                </div>

                {demandsChartData.length > 0 ? (
                  <ChartContainer
                    config={demandsChartConfig}
                    className="h-[280px] w-full"
                  >
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Pie
                        data={demandsChartData}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={62}
                        outerRadius={96}
                        paddingAngle={3}
                      >
                        {demandsChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <ChartLegend
                        content={<ChartLegendContent nameKey="label" />}
                      />
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
                    Sem demandas em aberto para distribuir no grafico.
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="ring-border">
              <CardHeader>
                <CardTitle>Tarefas que precisam de atencao</CardTitle>
                <CardDescription>
                  Lista curta para a equipa agir logo no inicio do dia.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {dash.data.tasks_overdue_preview.length > 0 ? (
                  dash.data.tasks_overdue_preview.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-2xl border border-border/80 bg-muted/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">
                            {task.title}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Vencimento: {formatDateTime(task.due_at)}
                          </p>
                        </div>
                        <Badge variant="destructive">Atrasada</Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
                    <div className="flex items-center gap-2">
                      <CircleCheckBig className="size-4 text-primary" />
                      <p className="text-sm text-muted-foreground">
                        Nenhuma tarefa atrasada no momento.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="ring-border">
              <CardHeader>
                <CardTitle>Demandas vencidas</CardTitle>
                <CardDescription>
                  Priorizacao para destravar entregas e proteger a experiencia
                  do cliente.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {dash.data.demands_overdue_preview.length > 0 ? (
                  dash.data.demands_overdue_preview.map((demand) => (
                    <div
                      key={demand.id}
                      className="rounded-2xl border border-border/80 bg-muted/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">
                            {demand.title}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {labelForStatus(demand.status, demandStatusLabels)} ·{" "}
                            prazo {formatDateTime(demand.due_at)}
                          </p>
                        </div>
                        <Badge variant="outline">Revisar</Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
                    <div className="flex items-center gap-2">
                      <CircleCheckBig className="size-4 text-primary" />
                      <p className="text-sm text-muted-foreground">
                        Nenhuma demanda vencida no momento.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <Card className="ring-border">
            <CardHeader>
              <CardTitle>Monitor tecnico</CardTitle>
              <CardDescription>
                Estado simplificado da API para apoio administrativo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={healthBadge.variant}>{healthBadge.label}</Badge>
                <span className="text-sm text-muted-foreground">{healthUrl()}</span>
              </div>
              {health.status === "loading" ? (
                <p className="text-sm text-muted-foreground">
                  A verificar integridade da API...
                </p>
              ) : health.status === "ok" ? (
                <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground">
                  {health.body}
                </pre>
              ) : (
                <p className="text-sm text-destructive">{health.message}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
