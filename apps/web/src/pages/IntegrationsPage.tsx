import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { apiBase } from "../api";

export function IntegrationsPage() {
  const webhookUrl = useMemo(() => `${apiBase()}/whatsapp/webhook`, []);

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          Integracoes do WhatsApp
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Utilize esta pagina como referencia rapida para configurar o recebimento
          de mensagens e validar o webhook junto a Meta.
        </p>
      </header>

      <Card className="ring-border">
        <CardHeader>
          <CardTitle className="text-base text-primary">Endereco do webhook</CardTitle>
          <CardDescription>
            A Meta usa este endereco para validar a ligacao e entregar eventos
            de mensagens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm text-primary">
              {webhookUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(webhookUrl)}
            >
              Copiar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="ring-border">
        <CardHeader>
          <CardTitle className="text-base text-primary">
            Variaveis necessarias
          </CardTitle>
          <CardDescription>
            Garanta que a API tenha estas configuracoes antes de ativar o fluxo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-inside list-disc space-y-2 text-sm text-foreground/90">
            <li>
              <code className="text-primary">WHATSAPP_VERIFY_TOKEN</code>:
              token usado na validacao do webhook.
            </li>
            <li>
              <code className="text-primary">WHATSAPP_APP_SECRET</code>: chave
              da aplicacao Meta para validar a assinatura dos eventos.
            </li>
            <li>
              <code className="text-primary">ALLOWED_PHONE_NUMBER_IDS</code>:
              opcional, para filtrar eventos por numeros autorizados.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="ring-border">
        <CardHeader>
          <CardTitle className="text-base text-primary">
            Identificador do numero
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-foreground/90">
            Esse identificador representa o numero WhatsApp Business ligado a sua
            app na Meta. O CRM usa esse valor para distinguir numeros, manter o
            historico correto e separar eventos por linha de atendimento.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
