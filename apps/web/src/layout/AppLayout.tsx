import type { CSSProperties } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AuthSessionProvider } from "@/auth/AuthSession";

import { logoutSession } from "../api";

const sidebarStyle = {
  "--sidebar-width": "calc(var(--spacing) * 72)",
  "--header-height": "calc(var(--spacing) * 12)",
} as CSSProperties;

export function AppLayout() {
  const navigate = useNavigate();

  async function logout() {
    await logoutSession();
    navigate("/login", { replace: true });
  }

  return (
    <AuthSessionProvider>
      <SidebarProvider style={sidebarStyle}>
        <AppSidebar variant="inset" onLogout={logout} />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                <div className="px-4 lg:px-6">
                  <Outlet />
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AuthSessionProvider>
  );
}
