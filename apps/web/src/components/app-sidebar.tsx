import * as React from "react";
import { Link } from "react-router-dom";
import {
  Building2Icon,
  CheckSquare2Icon,
  CommandIcon,
  InboxIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  PlugIcon,
  UsersIcon,
} from "lucide-react";

import { useAuthSession } from "@/auth/AuthSession";
import { NavMain, type NavMainItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems: NavMainItem[] = [
  {
    title: "Dashboard",
    to: "/dashboard",
    end: true,
    icon: <LayoutDashboardIcon className="size-4" />,
    requiredPermission: "dashboard.read",
  },
  {
    title: "Inbox",
    to: "/inbox",
    icon: <InboxIcon className="size-4" />,
  },
  {
    title: "Leads",
    to: "/leads",
    icon: <KanbanSquareIcon className="size-4" />,
  },
  {
    title: "Clientes",
    to: "/clients",
    icon: <Building2Icon className="size-4" />,
    requiredPermission: "clients.read",
  },
  {
    title: "Demandas",
    to: "/demands",
    icon: <ListTodoIcon className="size-4" />,
    requiredPermission: "demands.read",
  },
  {
    title: "Tasks",
    to: "/tasks",
    icon: <CheckSquare2Icon className="size-4" />,
    requiredPermission: "tasks.read",
  },
  {
    title: "Utilizadores",
    to: "/users",
    icon: <UsersIcon className="size-4" />,
    requiredPermission: "users.manage",
  },
  {
    title: "Integrações",
    to: "/integrations",
    icon: <PlugIcon className="size-4" />,
  },
];

export function AppSidebar({
  onLogout,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onLogout: () => void | Promise<void>;
}) {
  const { hasPermission, loading, me } = useAuthSession();

  const visibleItems = navItems.filter(
    (item) => !item.requiredPermission || hasPermission(item.requiredPermission),
  );

  const currentUser = {
    name: me?.email?.split("@")[0] || "Utilizador",
    email: loading
      ? "A carregar sessão..."
      : me
        ? `${me.email} · ${me.role}`
        : "Sessão SignaCon",
    avatar: "",
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link to="/dashboard">
                <CommandIcon className="size-5!" />
                <span className="text-base font-semibold">SignaCon CRM</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={visibleItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={currentUser} onLogout={onLogout} />
      </SidebarFooter>
    </Sidebar>
  );
}
