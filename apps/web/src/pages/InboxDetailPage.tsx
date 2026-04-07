import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  fetchConversation,
  fetchConversationMessages,
  fetchUsersForAssignment,
  markConversationResponded,
  patchConversationAssignee,
  type AssignmentUserRow,
  type ConversationDetail,
  type MessageRow,
} from "../api";

export function InboxDetailPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { hasPermission } = useAuthSession();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [assignees, setAssignees] = useState<AssignmentUserRow[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAssignConversation = hasPermission("whatsapp.conversations.assign");

  const load = useCallback(async () => {
    if (!conversationId) return;
    setError(null);
    try {
      const [detail, history] = await Promise.all([
        fetchConversation(conversationId),
        fetchConversationMessages(conversationId, "asc"),
      ]);
      setConv(detail);
      setMessages(history);
      setAssigneeId(detail.assigned_user_id ?? "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canAssignConversation) return;
    fetchUsersForAssignment().then(setAssignees).catch(() => setAssignees([]));
  }, [canAssignConversation]);

  async function markAnswered() {
    if (!conversationId) return;
    setBusy(true);
    try {
      await markConversationResponded(conversationId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function assignConversation() {
    if (!conversationId || !assigneeId || !canAssignConversation) return;
    setBusy(true);
    try {
      await patchConversationAssignee(conversationId, assigneeId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!conversationId) return <p className="text-destructive">ID invalido.</p>;

  return (
    <div className="space-y-6">
      <p>
        <Link to="/inbox" className="text-sm text-primary hover:underline">
          {"<-"} Inbox
        </Link>
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!conv ? (
        <Card className="ring-border">
          <CardContent className="pt-1">
            <p className="text-sm text-muted-foreground">
              A carregar conversa...
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="ring-border">
            <CardHeader>
              <CardTitle>{conv.wa_id}</CardTitle>
              <CardDescription>
                {conv.unanswered
                  ? "Conversa a aguardar resposta."
                  : "Conversa marcada como respondida."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {conv.last_message_preview ? (
                <div className="rounded-xl border border-border/80 bg-muted/30 p-4 text-sm text-foreground/90">
                  {conv.last_message_preview}
                </div>
              ) : null}
              <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                {conv.unanswered ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void markAnswered()}
                  >
                    Marcar como respondida
                  </Button>
                ) : null}
                {canAssignConversation ? (
                  <div className="space-y-2">
                    <Label htmlFor="conversation-assignee">Responsavel</Label>
                    <div className="flex flex-wrap gap-2">
                      <Select value={assigneeId} onValueChange={setAssigneeId} disabled={busy}>
                        <SelectTrigger id="conversation-assignee" className="min-w-[14rem]">
                          <SelectValue placeholder="Escolha um responsavel" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Sem responsavel</SelectItem>
                          {assignees.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || !assigneeId || assigneeId === "unassigned"}
                        onClick={() => void assignConversation()}
                      >
                        Guardar atribuicao
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="ring-border">
            <CardHeader>
              <CardTitle>Historico</CardTitle>
              <CardDescription>
                Sequencia de mensagens recebidas e processadas nesta conversa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem mensagens.</p>
              ) : null}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-border/80 bg-card p-3"
                >
                  <p className="text-sm text-foreground">{m.textBody ?? "-"}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {m.messageType} ·{" "}
                    {m.providerTimestamp
                      ? new Date(m.providerTimestamp).toLocaleString()
                      : new Date(m.receivedAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
