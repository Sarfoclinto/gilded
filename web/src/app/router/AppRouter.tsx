import { Route, Routes } from 'react-router-dom';
import LoginPage from '@/features/auth/pages/LoginPage';
import AppShell from '@/layouts/AppShell';
import { RequireAuth } from './guards';
import { appRoutes, guarded } from './routes';

function NotFound() {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold">Page not found</h2>
    </div>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {appRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={guarded(r)} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
