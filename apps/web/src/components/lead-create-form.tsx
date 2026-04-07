import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CurrencyInput } from "@/components/CurrencyInput";
import { leadStatusLabels } from "@/lib/domain-labels";
import { currencyInputToNumber } from "@/lib/currency-input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
  createManualLead,
  fetchUsersForAssignment,
  type AssignmentUserRow,
} from "../api";

const STATUS_OPTIONS = ["new", "contacted", "qualified", "lost"] as const;

const leadCreateFormSchema = z
  .object({
    waId: z.string(),
    displayName: z.string(),
    city: z.string(),
    email: z
      .string()
      .refine(
        (s) => {
          const t = s.trim();
          if (t === "") return true;
          return z.string().email().safeParse(t).success;
        },
        { message: "Email invalido." },
      ),
    phoneSecondary: z.string(),
    notes: z.string(),
    potentialValue: z.string(),
    source: z.string().min(1, "Indique a origem."),
    status: z.enum(STATUS_OPTIONS),
    assignedUserId: z.string(),
  })
  .superRefine((data, ctx) => {
    const wa = data.waId.trim();
    const name = data.displayName.trim();
    const potential = data.potentialValue.trim();

    if (!wa && name.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sem WhatsApp, informe o nome com pelo menos 2 caracteres.",
        path: ["displayName"],
      });
    }

    if (potential !== "") {
      const amount = currencyInputToNumber(potential);
      if (amount === null || !Number.isFinite(amount) || amount < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe um valor valido.",
          path: ["potentialValue"],
        });
      }
    }
  });

export type LeadCreateFormValues = z.infer<typeof leadCreateFormSchema>;

export function LeadCreateForm({
  onSuccess,
  onCancel,
  cancelLabel = "Cancelar",
}: {
  onSuccess: (leadId: string) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const [assignees, setAssignees] = useState<AssignmentUserRow[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<LeadCreateFormValues>({
    resolver: zodResolver(leadCreateFormSchema),
    defaultValues: {
      waId: "",
      displayName: "",
      city: "",
      email: "",
      phoneSecondary: "",
      notes: "",
      potentialValue: "",
      source: "manual",
      status: "new",
      assignedUserId: "",
    },
  });

  useEffect(() => {
    fetchUsersForAssignment()
      .then(setAssignees)
      .catch(() => setAssignees([]));
  }, []);

  async function onValid(data: LeadCreateFormValues) {
    setSubmitError(null);
    const wa = data.waId.trim();

    try {
      const potentialValue = currencyInputToNumber(data.potentialValue);
      const lead = await createManualLead({
        ...(wa ? { wa_id: wa } : {}),
        source: data.source.trim(),
        display_name: data.displayName.trim() || undefined,
        city: data.city.trim() || undefined,
        email: data.email.trim() || undefined,
        phone_secondary: data.phoneSecondary.trim() || undefined,
        notes: data.notes.trim() || undefined,
        potential_value: potentialValue ?? undefined,
        status: data.status,
        assigned_user_id: data.assignedUserId || undefined,
      });
      onSuccess(lead.id);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  const loading = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => void form.handleSubmit(onValid)(e)}
        className="space-y-4"
      >
        <Tabs defaultValue="contact" className="space-y-4">
          <TabsList variant="line">
            <TabsTrigger value="contact">Contato</TabsTrigger>
            <TabsTrigger value="commercial">Comercial</TabsTrigger>
            <TabsTrigger value="routing">Fluxo</TabsTrigger>
          </TabsList>

          <TabsContent value="contact" className="space-y-4">
            <FormField
              control={form.control}
              name="waId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ID do WhatsApp - opcional</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: 5511999999999"
                      className="font-mono"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do contato</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome do contato" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cidade</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="phoneSecondary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone secundario</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="commercial" className="space-y-4">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="potentialValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor potencial</FormLabel>
                  <FormControl>
                    <CurrencyInput
                      placeholder="R$ 0,00"
                      value={field.value}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Origem</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: manual, telefone ou importacao"
                      required
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="routing" className="space-y-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status inicial</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {leadStatusLabels[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="assignedUserId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Responsavel (opcional)</FormLabel>
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={(v) =>
                      field.onChange(v === "__none__" ? "" : v)
                    }
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Sem responsavel" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Sem responsavel</SelectItem>
                      {assignees.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>
        </Tabs>

        {submitError ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? "A guardar..." : "Criar lead"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              {cancelLabel}
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  );
}
