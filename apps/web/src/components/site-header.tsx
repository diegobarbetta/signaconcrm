import { useLocation } from "react-router-dom";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const routeTitles: { prefix: string; title: string }[] = [
  { prefix: "/leads/new", title: "Novo lead" },
  { prefix: "/integrations", title: "Integrações" },
  { prefix: "/users", title: "Utilizadores" },
  { prefix: "/tasks", title: "Tasks" },
  { prefix: "/demands", title: "Demandas" },
  { prefix: "/clients", title: "Clientes" },
  { prefix: "/leads", title: "Leads" },
  { prefix: "/inbox", title: "Inbox" },
  { prefix: "/dashboard", title: "Dashboard" },
];

function titleForPath(pathname: string): string {
  const hit = routeTitles.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  return hit?.title ?? "SignaCon CRM";
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const title = titleForPath(pathname);

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
      </div>
    </header>
  );
}
