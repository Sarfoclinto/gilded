import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { TextField } from "@/shared/ui/TextField";
import { errorMessage } from "@/shared/api/errors";
import { useLogin } from "../hooks";
import { useAuth } from "../store";

const COMPANY_KEY = "gold.company.v1";

export default function LoginPage() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState(() => {
    try {
      return localStorage.getItem(COMPANY_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (status === "authenticated") return <Navigate to={from} replace />;

  const fields = login.error?.fieldErrors;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const co = company.trim();
    try {
      localStorage.setItem(COMPANY_KEY, co);
    } catch {
      /* private mode: just do not remember it */
    }
    login.mutate({
      username: username.trim(),
      password,
      ...(co ? { company: co } : {}),
    });
  };

  return (
    <main className="grid min-h-full place-items-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-bold">Gold Valuation</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Sign in to continue
        </p>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <TextField
            label="Company"
            hint="Leave empty to use the default company"
            autoComplete="organization"
            autoCapitalize="none"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            error={fields?.company?.[0]}
          />
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
