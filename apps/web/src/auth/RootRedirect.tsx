import { Navigate } from "react-router-dom";

import { getAccessToken } from "../api";

export function RootRedirect() {
  if (getAccessToken()) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/login" replace />;
}
