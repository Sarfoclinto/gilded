import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { errorMessage } from '@/shared/api/errors';
import { useLogin } from '../hooks';
import { useAuth } from '../store';

export default function LoginPage() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (status === 'authenticated') return <Navigate to={from} replace />;

  const fields = login.error?.fieldErrors;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username: username.trim(), password });
  };

  return (
    <main className="grid min-h-full place-items-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-bold">Gold Valuation</h1>
        <p className="mb-4 text-sm text-muted">Sign in to continue</p>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <TextField
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fields?.username?.[0]}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fields?.password?.[0]}
          />
          {login.error && !fields ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorMessage(login.error)}
            </p>
          ) : null}
          <Button type="submit" className="w-full" loading={login.isPending}>
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  );
}
