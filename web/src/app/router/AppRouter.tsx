import { Route, Routes } from "react-router-dom";
import paths from "@/config/paths";
import LoginPage from "@/features/auth/pages/LoginPage";
import AppLayout from "@/layouts/AppLayout";
import { NotFoundPage, UnauthorizedPage } from "@/shared/ui/ErrorPages";
import { RequireAuth } from "./guards";
import { appRoutes, guarded, receiptRoute } from "./routes";
import { Suspense } from "react";

export function AppRouter() {
  return (
    <Routes>
      <Route path={paths.auth.login.href} element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        {/* The receipt has no menu or header around it, so it prints clean and can be opened by itself. */}
        <Route
          path={receiptRoute.path}
          element={<Suspense fallback={null}>{guarded(receiptRoute)}</Suspense>}
        />
        <Route element={<AppLayout />}>
          {appRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={guarded(r)} />
          ))}
          <Route
            path={paths.unauthorized.href}
            element={<UnauthorizedPage />}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
