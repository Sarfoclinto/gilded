import { Route, Routes } from 'react-router-dom';
import paths from '@/config/paths';
import LoginPage from '@/features/auth/pages/LoginPage';
import AppLayout from '@/layouts/AppLayout';
import { NotFoundPage, UnauthorizedPage } from '@/shared/ui/ErrorPages';
import { RequireAuth } from './guards';
import { appRoutes, guarded } from './routes';

export function AppRouter() {
  return (
    <Routes>
      <Route path={paths.auth.login.href} element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          {appRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={guarded(r)} />
          ))}
          <Route path={paths.unauthorized.href} element={<UnauthorizedPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
