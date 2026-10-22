import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { PERMISSIONS } from '@/config/permissions';
import { branches, prices, users } from './data';
import { createTransaction, getTransaction, listTransactions } from './transactions';

/**
 * In-browser stand-in for the API, following docs/openapi.yaml. It lets the whole UI be built and
 * reviewed before the ASP.NET Core backend exists. Switch it off with VITE_USE_MOCK=false.
 * Demo logins: director, manager, teller. Password: gold.
 */
const REFRESH_KEY = 'mock.refresh';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ok = (config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse => ({
  data,
  status,
  statusText: String(status),
  headers: {},
  config,
});

const fail = (
  config: InternalAxiosRequestConfig,
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) => {
  const response = ok(config, status, { error: { code, message, fieldErrors, traceId: crypto.randomUUID() } });
  return Promise.reject(new AxiosError(message, String(status), config, null, response));
};

const tokenFor = (userId: string) => `mock-access.${userId}.${Date.now()}`;
const userFromToken = (config: InternalAxiosRequestConfig) => {
  const header = String(config.headers.get('Authorization') ?? '');
  const id = /^Bearer mock-access\.([^.]+)\./.exec(header)?.[1];
  return users.find((u) => u.id === id);
};
const session = (userId: string) => {
  const user = users.find((u) => u.id === userId)!;
  return { accessToken: tokenFor(user.id), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), user };
};

export const mockAdapter: AxiosAdapter = async (config) => {
  await sleep(120 + Math.random() * 180);
  const method = (config.method ?? 'get').toLowerCase();
  const path = (config.url ?? '').replace(/\?.*$/, '');

  if (method === 'post' && path === '/auth/login') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const fieldErrors: Record<string, string[]> = {};
    if (!body?.username) fieldErrors.username = ['Enter your username'];
    if (!body?.password) fieldErrors.password = ['Enter your password'];
    if (Object.keys(fieldErrors).length) return fail(config, 422, 'VALIDATION_FAILED', 'Check the highlighted fields.', fieldErrors);
    const user = users.find((u) => u.username === String(body.username).toLowerCase());
    if (!user || body.password !== 'gold') return fail(config, 401, 'AUTH_INVALID_CREDENTIALS', 'Wrong username or password.');
    localStorage.setItem(REFRESH_KEY, user.id);
    return ok(config, 200, { data: session(user.id) });
  }

  if (method === 'post' && path === '/auth/refresh') {
    const id = localStorage.getItem(REFRESH_KEY);
    if (!id) return fail(config, 401, 'AUTH_REFRESH_INVALID', 'Please sign in again.');
    return ok(config, 200, { data: session(id) });
  }

  if (method === 'post' && path === '/auth/logout') {
    localStorage.removeItem(REFRESH_KEY);
    return ok(config, 204, null);
  }

  // Everything below needs a valid access token.
  const user = userFromToken(config);
  if (!user) return fail(config, 401, 'AUTH_TOKEN_EXPIRED', 'Session expired.');

  if (method === 'get' && path === '/me') return ok(config, 200, { data: user });

  if (method === 'get' && path === '/branches') {
    const list = user.role === 'director' ? branches : branches.filter((b) => user.branchIds.includes(b.id));
    return ok(config, 200, { data: list });
  }

  if (method === 'get' && path === '/prices/current') {
    const branchId = String(config.params?.branchId ?? '');
    if (!user.branchIds.includes(branchId)) return fail(config, 403, 'BRANCH_NOT_ASSIGNED', 'You are not assigned to this branch.');
    const p = prices[branchId];
    if (!p) return fail(config, 404, 'NOT_FOUND', 'No price for this branch.');
    return ok(config, 200, {
      data: {
        branchId,
        basePrice: p.basePrice,
        margin: p.margin,
        effectivePrice: String(Number(p.basePrice) + Number(p.margin)),
        source: 'goldbod',
        status: p.status,
        asOf: new Date().toISOString(),
      },
    });
  }

  const can = (p: string) => user.permissions.includes(p);
  const failer = (status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) =>
    fail(config, status, code, message, fieldErrors);

  if (method === 'get' && path === '/transactions') {
    if (!can(PERMISSIONS.TRANSACTIONS_READ)) return fail(config, 403, 'FORBIDDEN', 'You cannot view transactions.');
    const branchId = String(config.params?.branchId ?? '');
    if (!user.branchIds.includes(branchId)) return fail(config, 403, 'BRANCH_NOT_ASSIGNED', 'You are not assigned to this branch.');
    return ok(config, 200, { data: listTransactions(branchId, Number(config.params?.limit ?? 50)) });
  }

  if (method === 'post' && path === '/transactions') {
    if (!can(PERMISSIONS.TRANSACTIONS_CREATE)) return fail(config, 403, 'FORBIDDEN', 'You cannot create transactions.');
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const res = await createTransaction(body, user, failer);
    return ok(config, res.status, { data: res.data });
  }

  const one = /^\/transactions\/([^/]+)$/.exec(path);
  if (method === 'get' && one) {
    if (!can(PERMISSIONS.TRANSACTIONS_READ)) return fail(config, 403, 'FORBIDDEN', 'You cannot view transactions.');
    const tx = getTransaction(decodeURIComponent(one[1]!));
    if (!tx || !user.branchIds.includes(tx.branchId)) return fail(config, 404, 'NOT_FOUND', 'Transaction not found.');
    return ok(config, 200, { data: tx });
  }

  return fail(config, 404, 'NOT_FOUND', `Mock has no ${method.toUpperCase()} ${path}`);
};
