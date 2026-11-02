import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { z } from "zod";
import { env } from "@/shared/lib/env";
import { ApiError } from "./errors";
import { dataEnvelope, errorEnvelope } from "./envelope";
import { session } from "./session";
import { noteServerDate } from "@/shared/offline/clock";

export const http = axios.create({
  baseURL: env.apiUrl,
  timeout: 20_000,
  withCredentials: true, // sends the httpOnly refresh cookie to /auth/*
  headers: { "Content-Type": "application/json" },
});

type Retriable = InternalAxiosRequestConfig & { _retried?: boolean };

const isAuthPath = (url?: string) =>
  !!url && /\/auth\/(login|refresh|logout)/.test(url);

http.interceptors.request.use((config) => {
  const token = session.getToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  config.headers.set("X-Client-Time", new Date().toISOString());
  config.headers.set(
    "X-Client-Version",
    typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
  );
  return config;
});

/**
 * Single-flight refresh: if five requests hit 401 together they all wait for one refresh call.
 * Resolves to the new token, or null when the session is really gone.
 */
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const res = await http.post("/auth/refresh");
      const parsed = z
        .object({ data: z.object({ accessToken: z.string() }) })
        .safeParse(res.data);
      if (!parsed.success) return null;
      session.setToken(parsed.data.data.accessToken);
      return parsed.data.data.accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export { refreshAccessToken };

http.interceptors.response.use(
  (r) => {
    noteServerDate(r.headers?.date as string | undefined);
    return r;
  },
  async (error: AxiosError) => {
    const original = error.config as Retriable | undefined;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !isAuthPath(original.url)
    ) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers.set("Authorization", `Bearer ${token}`);
        return http(original);
      }
      session.notifyLost();
    }
    return Promise.reject(error);
  },
);

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (axios.isAxiosError(e)) {
    if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") {
      return new ApiError({
        kind: "timeout",
        message: "Request timed out",
        cause: e,
      });
    }
    if (!e.response) {
      return new ApiError({
        kind: "network",
        message: "No response from server",
        cause: e,
      });
    }
    const parsed = errorEnvelope.safeParse(e.response.data);
    if (parsed.success) {
      const { code, message, fieldErrors, traceId } = parsed.data.error;
      return new ApiError({
        kind: "http",
        status: e.response.status,
        code,
        message,
        fieldErrors,
        traceId,
        cause: e,
      });
    }
    return new ApiError({
      kind: "http",
      status: e.response.status,
      code: "UNKNOWN",
      message: `Request failed (${e.response.status})`,
      cause: e,
    });
  }
  return new ApiError({
    kind: "network",
    message: e instanceof Error ? e.message : "Unknown error",
    cause: e,
  });
}

/**
 * Sends a request and returns the validated `data`. Every API call in the app goes through here, so
 * error shapes and response validation are decided in exactly one place.
 */
export async function request<S extends z.ZodType>(
  config: AxiosRequestConfig,
  schema: S,
): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = (await http.request(config)).data;
  } catch (e) {
    throw toApiError(e);
  }
  const parsed = dataEnvelope(schema).safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      kind: "bad-response",
      message: `Response did not match the contract for ${config.method ?? "get"} ${config.url}`,
      cause: parsed.error,
    });
  }
  return (parsed.data as { data: unknown }).data as z.infer<S>;
}

/** For endpoints that answer 204 No Content. */
export async function requestVoid(config: AxiosRequestConfig): Promise<void> {
  try {
    await http.request(config);
  } catch (e) {
    throw toApiError(e);
  }
}
