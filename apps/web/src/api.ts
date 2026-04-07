/** URL base da API (produção via VITE_API_URL) ou `/api` com proxy Vite em dev. */
export function apiBase(): string {
  const base = import.meta.env.VITE_API_URL?.trim();
  if (base) {
    return base.replace(/\/$/, "");
  }
  return "/api";
}

export function healthUrl(): string {
  return `${apiBase()}/health`;
}

const TOKEN_KEY = "signacon_access_token";
const REFRESH_KEY = "signacon_refresh_token";

export function getAccessToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getRefreshToken(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(REFRESH_KEY, token);
    } else {
      sessionStorage.removeItem(REFRESH_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function clearAuth(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshSession(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${apiBase()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
      };
      if (!res.ok || !data.access_token || !data.refresh_token) {
        return false;
      }
      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export type LoginTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginTokens> {
  const res = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as LoginTokens & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Resposta de login inválida");
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  };
}

export async function logoutSession(): Promise<void> {
  const rt = getRefreshToken();
  if (rt) {
    try {
      await fetch(`${apiBase()}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
    } catch {
      /* ignore */
    }
  }
  clearAuth();
}

export type DashboardSummaryPayload = {
  generated_at: string;
  leads_by_status: Record<string, number>;
  lead_value: {
    total_potential: number;
    by_status: Record<string, number>;
    avg_days_in_status: Record<string, number>;
  };
  clients: {
    total_generated_value: number;
    avg_generated_value: number;
  };
  tasks: {
    overdue: number;
    today: number;
    upcoming: number;
    open_total: number;
  };
  demands: {
    overdue: number;
    by_status: Record<string, number>;
  };
  tasks_overdue_preview: Array<{
    id: string;
    title: string;
    due_at: string;
    assigned_user_id: string | null;
  }>;
  demands_overdue_preview: Array<{
    id: string;
    title: string;
    due_at: string;
    status: string;
    assigned_user_id: string | null;
  }>;
};

export async function fetchDashboardSummary(
  opts?: { taskPreviewLimit?: number; demandPreviewLimit?: number },
): Promise<DashboardSummaryPayload> {
  const t = opts?.taskPreviewLimit ?? 5;
  const d = opts?.demandPreviewLimit ?? 5;
  const q = new URLSearchParams({
    task_preview_limit: String(t),
    demand_preview_limit: String(d),
  });
  return apiJson<DashboardSummaryPayload>(`/dashboard/summary?${q}`);
}

/** Pedido autenticado; renova access token em 401 se existir refresh token. */
async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  const run = async (): Promise<Response> => {
    const token = getAccessToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(`${apiBase()}${path}`, { ...init, headers });
  };

  let res = await run();
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      res = await run();
    }
  }
  return res;
}

/** GET/POST/PATCH autenticado; renova access token em 401 se existir refresh token. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiRequest(path, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401) {
      clearAuth();
    }
    throw new Error(
      typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
    );
  }
  return data as T;
}

/** DELETE (ex.: 204 sem corpo). */
async function deleteNoContent(path: string): Promise<void> {
  const res = await apiRequest(path, { method: "DELETE" });
  if (res.status === 204) return;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401) clearAuth();
    throw new Error(
      typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
    );
  }
}

export async function deleteLead(leadId: string): Promise<void> {
  return deleteNoContent(`/leads/${leadId}`);
}

export async function deleteClient(clientId: string): Promise<void> {
  return deleteNoContent(`/clients/${clientId}`);
}

export async function archiveClient(
  clientId: string,
  body: { reason: string },
): Promise<{ lead_id: string; status: string }> {
  return apiJson(`/clients/${clientId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type ConversationRow = {
  id: string;
  wa_id: string;
  phone_number_id: string;
  unanswered: boolean;
  assigned_user_id: string | null;
  last_provider_timestamp: string | null;
  last_message_preview: string | null;
  last_activity_at: string;
};

export async function fetchConversations(opts?: {
  limit?: number;
  unanswered?: boolean;
  mine?: boolean;
}): Promise<ConversationRow[]> {
  const sp = new URLSearchParams();
  sp.set("limit", String(opts?.limit ?? 50));
  if (opts?.unanswered === true) sp.set("unanswered", "1");
  if (opts?.mine === true) sp.set("mine", "1");
  return apiJson<ConversationRow[]>(`/whatsapp/conversations?${sp.toString()}`);
}

export async function patchConversationUnanswered(
  conversationId: string,
  unanswered: boolean,
): Promise<{ ok: boolean }> {
  return apiJson(`/whatsapp/conversations/${conversationId}/unanswered`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unanswered }),
  });
}

export type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  assigned_user_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  client_id: string | null;
  demand_id: string | null;
  /** Contexto da demanda vinculada (quando `demand_id` existe). */
  demand_lead_id: string | null;
  demand_client_id: string | null;
  /** Cliente quando o `lead_id` da task é um lead já convertido. */
  lead_client_id: string | null;
  source: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TasksListResponse = {
  items: TaskRow[];
  total: number;
  limit: number;
  offset: number;
};

export async function fetchTasksMine(params?: {
  status?: "open" | "done";
}): Promise<TasksListResponse> {
  const sp = new URLSearchParams();
  sp.set("mine", "true");
  sp.set("limit", "100");
  sp.set("include_done", "true");
  if (params?.status) sp.set("status", params.status);
  return apiJson<TasksListResponse>(`/tasks?${sp.toString()}`);
}

export async function fetchTasksForLead(
  leadId: string,
  limit = 50,
): Promise<TasksListResponse> {
  const sp = new URLSearchParams();
  sp.set("lead_id", leadId);
  sp.set("limit", String(limit));
  sp.set("include_done", "true");
  return apiJson<TasksListResponse>(`/tasks?${sp.toString()}`);
}

export async function fetchTasksForClient(
  clientId: string,
  limit = 50,
): Promise<TasksListResponse> {
  const sp = new URLSearchParams();
  sp.set("client_id", clientId);
  sp.set("limit", String(limit));
  sp.set("include_done", "true");
  return apiJson<TasksListResponse>(`/tasks?${sp.toString()}`);
}

export async function createTask(body: {
  title: string;
  status: "open";
  due_at?: string | null;
  assigned_user_id?: string;
  lead_id?: string;
  client_id?: string;
  conversation_id?: string;
  demand_id?: string;
}): Promise<TaskRow> {
  return apiJson<TaskRow>("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patchTask(
  id: string,
  body: { status: string },
): Promise<TaskRow> {
  return apiJson<TaskRow>(`/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteTask(id: string): Promise<void> {
  return deleteNoContent(`/tasks/${id}`);
}

export type DemandRow = {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  status: string;
  assigned_user_id: string | null;
  lead_id: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DemandsListResponse = {
  items: DemandRow[];
  total: number;
  limit: number;
  offset: number;
};

export async function fetchDemands(params?: {
  client_id?: string;
  lead_id?: string;
  limit?: number;
  status?: string;
}): Promise<DemandsListResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", String(params?.limit ?? 50));
  if (params?.client_id) sp.set("client_id", params.client_id);
  if (params?.lead_id) sp.set("lead_id", params.lead_id);
  if (params?.status) sp.set("status", params.status);
  return apiJson<DemandsListResponse>(`/demands?${sp.toString()}`);
}

export async function createDemand(body: {
  title: string;
  description?: string;
  due_at: string;
  status: string;
  assigned_user_id?: string;
  lead_id?: string;
  client_id?: string;
}): Promise<DemandRow> {
  return apiJson<DemandRow>("/demands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patchDemand(
  id: string,
  body: { status?: string },
): Promise<DemandRow> {
  return apiJson<DemandRow>(`/demands/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteDemand(id: string): Promise<void> {
  return deleteNoContent(`/demands/${id}`);
}

export type ClientRow = {
  id: string;
  lead_id: string;
  wa_id: string;
  display_name: string | null;
  reference_value: number | null;
  real_value: number;
  created_at: string;
};

export type ClientsListResponse = {
  items: ClientRow[];
  total: number;
  limit: number;
  offset: number;
};

export async function fetchClients(): Promise<ClientsListResponse> {
  return apiJson<ClientsListResponse>("/clients?limit=50");
}

export type ClientDetail = {
  id: string;
  lead_id: string;
  wa_id: string;
  display_name: string | null;
  notes: string | null;
  reference_value: number | null;
  real_value: number;
  created_at: string;
  services: Array<{
    id: string;
    name: string;
    status: string;
    amount: number;
    renews_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

export async function fetchClient(id: string): Promise<ClientDetail> {
  return apiJson<ClientDetail>(`/clients/${id}`);
}

export async function patchClient(
  id: string,
  body: {
    display_name?: string | null;
    notes?: string | null;
    reference_value?: number | null;
  },
): Promise<{
  id: string;
  lead_id: string;
  display_name: string | null;
  notes: string | null;
  reference_value: number | null;
  real_value: number;
}> {
  return apiJson(`/clients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function createClientService(
  clientId: string,
  body: { name: string; status: string; amount: number; renews_at?: string },
): Promise<{
  id: string;
  name: string;
  status: string;
  amount: number;
  renews_at: string | null;
  created_at: string;
  updated_at: string;
}> {
  return apiJson(`/clients/${clientId}/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patchClientService(
  clientId: string,
  serviceId: string,
  body: {
    name?: string;
    status?: string;
    amount?: number;
    renews_at?: string | null;
  },
): Promise<{
  id: string;
  name: string;
  status: string;
  amount: number;
  renews_at: string | null;
  created_at: string;
  updated_at: string;
}> {
  return apiJson(`/clients/${clientId}/services/${serviceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type UserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  role: { id: string; name: string };
  created_at: string;
  updated_at: string;
};

export async function fetchUsers(): Promise<UserRow[]> {
  return apiJson<UserRow[]>("/users");
}

export type LeadListItem = {
  id: string;
  source: string;
  status: string;
  assigned_user_id: string | null;
  wa_id: string | null;
  display_name: string | null;
  city: string | null;
  email: string | null;
  phone_secondary: string | null;
  potential_value: number | null;
  current_status_days: number;
  created_at: string;
  updated_at: string;
};

export type LeadsListResponse = {
  items: LeadListItem[];
  total: number;
  limit: number;
  offset: number;
};

export async function fetchLeads(params?: {
  status?: string;
  q?: string;
  limit?: number;
}): Promise<LeadsListResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", String(params?.limit ?? 50));
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  return apiJson<LeadsListResponse>(`/leads?${sp.toString()}`);
}

export type LeadNoteEntry = {
  id: string;
  body: string;
  created_at: string;
  created_by: { id: string; name: string } | null;
};

export type LeadDetail = {
  id: string;
  source: string;
  status: string;
  assigned_user_id: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
  wa_id: string | null;
  display_name: string | null;
  city: string | null;
  email: string | null;
  phone_secondary: string | null;
  potential_value: number | null;
  current_status_days: number;
  note_entries: LeadNoteEntry[];
  conversations: Array<{
    id: string;
    phone_number_id: string;
    unanswered: boolean;
    assigned_user_id: string | null;
    last_message_preview: string | null;
    last_activity_at: string;
  }>;
  status_events: Array<{
    id: string;
    from_status: string | null;
    to_status: string;
    created_at: string;
  }>;
};

export async function fetchLead(id: string): Promise<LeadDetail> {
  return apiJson<LeadDetail>(`/leads/${id}`);
}

export type ConversationDetail = {
  id: string;
  wa_id: string;
  phone_number_id: string;
  unanswered: boolean;
  assigned_user_id: string | null;
  last_message_preview: string | null;
  last_activity_at: string;
};

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  return apiJson<ConversationDetail>(`/whatsapp/conversations/${id}`);
}

export type MessageRow = {
  id: string;
  providerMessageId: string;
  messageType: string;
  textBody: string | null;
  providerTimestamp: string | null;
  receivedAt: string;
  waId: string;
  phoneNumberId: string;
};

export async function fetchConversationMessages(
  conversationId: string,
  order: "asc" | "desc" = "desc",
): Promise<MessageRow[]> {
  const sp = new URLSearchParams({ limit: "80", order });
  return apiJson<MessageRow[]>(
    `/whatsapp/conversations/${conversationId}/messages?${sp.toString()}`,
  );
}

export type RoleRow = {
  id: string;
  name: string;
  data_scope: string;
};

export async function fetchRoles(): Promise<RoleRow[]> {
  return apiJson<RoleRow[]>("/roles");
}

export type MeResponse = {
  id: string;
  email: string;
  role: string;
  data_scope: string;
  permissions: string[];
};

/** Sessão actual (GET /rbac/me). */
export async function fetchMe(): Promise<MeResponse> {
  return apiJson<MeResponse>("/rbac/me");
}

export async function createUser(body: {
  name: string;
  email: string;
  password: string;
  role: string;
}): Promise<UserRow> {
  return apiJson<UserRow>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patchUser(
  id: string,
  body: { role?: string; status?: string },
): Promise<UserRow> {
  return apiJson<UserRow>(`/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type AssignmentUserRow = {
  id: string;
  name: string;
  email: string;
};

export async function fetchUsersForAssignment(): Promise<AssignmentUserRow[]> {
  return apiJson<AssignmentUserRow[]>("/users/for-assignment");
}

export async function patchLeadStatus(
  leadId: string,
  status: string,
): Promise<unknown> {
  return apiJson(`/leads/${leadId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function patchLeadAssignee(
  leadId: string,
  assignedUserId: string,
): Promise<{ ok: boolean; assigned_user_id: string }> {
  return apiJson(`/leads/${leadId}/assignee`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assigned_user_id: assignedUserId }),
  });
}

export async function convertLead(leadId: string): Promise<{
  ok: boolean;
  client_id: string;
  lead_id: string;
}> {
  return apiJson(`/leads/${leadId}/convert`, { method: "POST" });
}

export async function postLeadNote(
  leadId: string,
  body: string,
): Promise<{ ok: boolean }> {
  return apiJson(`/leads/${leadId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export async function patchLeadProfile(
  leadId: string,
  body: {
    display_name?: string;
    city?: string;
    email?: string;
    phone_secondary?: string;
    potential_value?: number | null;
  },
): Promise<{ ok: boolean }> {
  return apiJson(`/leads/${leadId}/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function markConversationResponded(
  conversationId: string,
): Promise<{ ok: boolean }> {
  return apiJson(`/whatsapp/conversations/${conversationId}/responded`, {
    method: "POST",
  });
}

export async function patchConversationAssignee(
  conversationId: string,
  assignedUserId: string,
): Promise<{ ok: boolean }> {
  return apiJson(`/whatsapp/conversations/${conversationId}/assignee`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assigned_user_id: assignedUserId }),
  });
}

export type ManualLeadCreated = {
  id: string;
  source: string;
  status: string;
  wa_id: string | null;
  display_name: string | null;
  city: string | null;
  email: string | null;
  phone_secondary: string | null;
  potential_value: number | null;
  assigned_user_id: string | null;
  created_at: string;
};

export async function createManualLead(body: {
  wa_id?: string;
  source: string;
  display_name?: string;
  city?: string;
  email?: string;
  phone_secondary?: string;
  notes?: string;
  status?: string;
  assigned_user_id?: string;
  potential_value?: number;
}): Promise<ManualLeadCreated> {
  const payload: Record<string, unknown> = {
    source: body.source,
  };
  const wa = body.wa_id?.trim();
  if (wa) payload.wa_id = wa;
  if (body.display_name?.trim()) payload.display_name = body.display_name.trim();
  if (body.city?.trim()) payload.city = body.city.trim();
  if (body.email?.trim()) payload.email = body.email.trim();
  if (body.phone_secondary?.trim()) payload.phone_secondary = body.phone_secondary.trim();
  if (body.notes?.trim()) payload.notes = body.notes.trim();
  if (body.status) payload.status = body.status;
  if (body.assigned_user_id) payload.assigned_user_id = body.assigned_user_id;
  if (typeof body.potential_value === "number") {
    payload.potential_value = body.potential_value;
  }
  return apiJson<ManualLeadCreated>("/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
