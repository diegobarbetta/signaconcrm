import { Link, useNavigate } from "react-router-dom";

import { LeadCreateForm } from "@/components/lead-create-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LeadCreatePage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <p>
        <Link to="/leads" className="text-sm text-primary hover:underline">
          {"<-"} Leads
        </Link>
      </p>
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          Novo lead manual
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preencha os dados principais para iniciar o acompanhamento comercial.
          Se houver numero de WhatsApp, inclua-o para facilitar o atendimento.
        </p>
      </header>

      <Card className="max-w-2xl ring-border">
        <CardHeader>
          <CardTitle>Dados do lead</CardTitle>
          <CardDescription>
            Os campos foram separados por abas para facilitar o preenchimento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadCreateForm
            onSuccess={(id) => navigate(`/leads/${id}`, { replace: true })}
            cancelLabel="Voltar para a lista"
            onCancel={() => navigate("/leads")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
