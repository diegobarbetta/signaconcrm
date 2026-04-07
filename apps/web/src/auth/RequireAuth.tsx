import { Navigate, Outlet } from "react-router-dom";

import { getAccessToken } from "../api";

/** Redirecciona para `/login` se não houver token (UX-DR1). */
export function RequireAuth() {
  if (!getAccessToken()) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
