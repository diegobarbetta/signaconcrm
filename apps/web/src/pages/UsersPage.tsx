import { type FormEvent, useCallback, useEffect, useState } from "react";

import { useAuthSession } from "@/auth/AuthSession";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  type RoleRow,
  type UserRow,
  createUser,
  fetchRoles,
  fetchUsers,
  patchUser,
} from "../api";

export function UsersPage() {
  const { hasPermission, loading: authLoading } = useAuthSession();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; users: UserRow[]; roles: RoleRow[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleName, setRoleName] = useState("atendimento");
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const canManageUsers = hasPermission("users.manage");

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([fetchUsers(), fetchRoles()])
      .then(([users, roles]) => {
        setState({ status: "ok", users, roles });
      })
      .catch((err: unknown) =>
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  useEffect(() => {
    if (!canManageUsers) return;
    load();
  }, [canManageUsers, load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateMsg(null);
    try {
      await createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: roleName,
      });
      setName("");
      setEmail("");
      setPassword("");
      setCreateMsg("Utilizador criado com sucesso.");
      load();
    } catch (err: unknown) {
      setCreateMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveRow(u: UserRow, next: { role?: string; status?: string }) {
    setSavingId(u.id);
    setCreateMsg(null);
    try {
      await patchUser(u.id, next);
      load();
    } catch (err: unknown) {
      setCreateMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  if (authLoading) {
    return <p className="text-muted-foreground">A carregar sessao...</p>;
  }

  if (!canManageUsers) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Utilizadores</h1>
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Esta area esta disponivel apenas para perfis com permissao para gerir
          utilizadores.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Utilizadores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie utilizadores, altere perfis e ajuste o estado das contas.
        </p>
      </header>

      {state.status === "loading" ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar utilizadores...
            </p>
          </CardContent>
        </Card>
      ) : state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : (
        <>
          <Card className="ring-border">
            <CardHeader>
              <CardTitle>Novo utilizador</CardTitle>
              <CardDescription>
                Crie um acesso com o perfil adequado para a equipa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={onCreate}
                className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_14rem_auto]"
              >
                <div className="space-y-2">
                  <Label htmlFor="user-name">Nome</Label>
                  <Input
                    id="user-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome completo"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-email">Email</Label>
                  <Input
                    id="user-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@empresa.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-password">Palavra-passe</Label>
                  <Input
                    id="user-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimo de 8 caracteres"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-role">Perfil</Label>
                  <Select value={roleName} onValueChange={setRoleName}>
                    <SelectTrigger id="user-role" className="w-full">
                      <SelectValue placeholder="Escolha o perfil" />
                    </SelectTrigger>
                    <SelectContent>
                      {state.roles.map((r) => (
                        <SelectItem key={r.id} value={r.name}>
                          {r.name} ({r.data_scope})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="w-full xl:w-auto">
                    Criar utilizador
                  </Button>
                </div>
              </form>
              {createMsg ? (
                <Alert className="mt-4">
                  <AlertDescription>{createMsg}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card className="ring-border">
            <CardHeader>
              <CardTitle>Acessos ativos</CardTitle>
              <CardDescription>
                Atualize o perfil e a disponibilidade de cada conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <ul className="divide-y divide-border">
                {state.users.map((u) => (
                  <li
                    key={`${u.id}-${u.updated_at}`}
                    className="flex flex-col gap-3 px-4 py-4 md:flex-row md:flex-wrap md:items-center md:justify-between"
                  >
                    <div>
                      <p className="font-medium text-foreground">{u.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {u.email} · Perfil atual: {u.role.name}
                      </p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[15rem_12rem_auto] md:items-center">
                      <div className="space-y-2">
                        <Label
                          htmlFor={`user-role-${u.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Perfil
                        </Label>
                        <Select
                          defaultValue={u.role.name}
                          disabled={savingId === u.id}
                          onValueChange={(v) => {
                            if (v !== u.role.name) {
                              void saveRow(u, { role: v });
                            }
                          }}
                        >
                          <SelectTrigger
                            id={`user-role-${u.id}`}
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {state.roles.map((r) => (
                              <SelectItem key={r.id} value={r.name}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label
                          htmlFor={`user-status-${u.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Estado
                        </Label>
                        <Select
                          defaultValue={u.status}
                          disabled={savingId === u.id}
                          onValueChange={(v) => {
                            if (v !== u.status) {
                              void saveRow(u, {
                                status: v as "active" | "disabled",
                              });
                            }
                          }}
                        >
                          <SelectTrigger
                            id={`user-status-${u.id}`}
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Ativo</SelectItem>
                            <SelectItem value="disabled">Desativado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {savingId === u.id ? (
                        <span className="text-xs text-muted-foreground">
                          A guardar...
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
