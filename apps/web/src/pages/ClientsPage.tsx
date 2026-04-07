import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuthSession } from "@/auth/AuthSession";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrencyBRL } from "@/lib/formatters";

import { fetchClients, type ClientRow } from "../api";

export function ClientsPage() {
  const { hasPermission, loading: authLoading } = useAuthSession();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; items: ClientRow[]; total: number }
    | { status: "error"; message: string }
  >({ status: "loading" });

  const canReadClients = hasPermission("clients.read");

  useEffect(() => {
    if (!canReadClients) return;
    fetchClients()
      .then((r) => setState({ status: "ok", items: r.items, total: r.total }))
      .catch((err: unknown) =>
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [canReadClients]);

  if (authLoading) {
    return <p className="text-muted-foreground">A carregar sessao...</p>;
  }

  if (!canReadClients) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Clientes</h1>
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Esta area esta disponivel apenas para perfis com permissao de leitura
          de clientes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Clientes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lista de clientes ativos e acesso rapido as suas fichas.
        </p>
      </header>

      {state.status === "loading" ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar clientes...
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
            Nenhum cliente encontrado.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Card className="ring-border">
              <CardContent className="pt-6">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Valor real contratado
                </p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {formatCurrencyBRL(
                    state.items.reduce(
                      (sum, item) => sum + item.real_value,
                      0,
                    ),
                  )}
                </p>
              </CardContent>
            </Card>
            <Card className="ring-border">
              <CardContent className="pt-6">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Ticket medio
                </p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {formatCurrencyBRL(
                    state.items.length > 0
                      ? state.items.reduce(
                          (sum, item) => sum + item.real_value,
                          0,
                        ) / state.items.length
                      : 0,
                  )}
                </p>
              </CardContent>
            </Card>
          </div>
          <p className="text-sm text-muted-foreground">
            Total de clientes: {state.total}
          </p>
          <ul className="space-y-3">
            {state.items.map((c) => (
              <li key={c.id}>
                <Link to={`/clients/${c.id}`} className="block">
                  <Card className="ring-border transition-colors hover:bg-muted/20">
                    <CardHeader>
                      <CardTitle className="text-base">
                        {c.display_name ?? c.wa_id}
                      </CardTitle>
                      <CardDescription>{c.wa_id}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        Real: {formatCurrencyBRL(c.real_value)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fechamento de referencia: {formatCurrencyBRL(c.reference_value)}
                      </p>
                      <p className="mt-2 text-xs text-primary">Abrir ficha</p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
