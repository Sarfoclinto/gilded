import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import { refreshAccessToken } from "@/shared/api/client";
import { session } from "@/shared/api/session";
import { env } from "@/shared/lib/env";

/** Where the live-updates hub is: the API's origin plus /hubs/live. */
export const hubUrl = () =>
  new URL(
    "/hubs/live",
    new URL(
      env.apiUrl,
      typeof window === "undefined" ? undefined : window.location.origin,
    ),
  ).toString();

/** Seconds until the token expires (negative when it already has). Unreadable tokens count as expired. */
export function secondsLeft(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return (payload.exp ?? 0) - Date.now() / 1000;
  } catch {
    return -1;
  }
}

/** A token that is good for at least half a minute, refreshing it first when needed. */
export async function freshToken(): Promise<string> {
  const current = session.getToken();
  if (current && secondsLeft(current) > 30) return current;
  return (await refreshAccessToken()) ?? "";
}

export type LiveHandlers = {
  changed: (topic: string) => void;
  notification: (n: {
    id: string;
    kind: string;
    title: string;
    link?: string | null;
  }) => void;
  /** After a reconnect or a server resync: events may have been missed, so refresh what is on screen. */
  resync: () => void;
};

/**
 * One WebSocket connection to the server for live updates. It reconnects by itself, with growing pauses, for as long as it is running,
 * and hands out a fresh token on every attempt. Returns a function that stops it.
 */
export function startLive(h: LiveHandlers): () => void {
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connection: HubConnection = new HubConnectionBuilder()
    .withUrl(hubUrl(), { accessTokenFactory: freshToken })
    .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
    .configureLogging(LogLevel.Warning)
    .build();

  connection.on("changed", (e: { topic: string }) => h.changed(e.topic));
  connection.on("notification", (n) => h.notification(n));
  connection.on("resync", () => h.resync());
  connection.onreconnected(() => h.resync());

  const connect = async () => {
    if (stopped || connection.state !== HubConnectionState.Disconnected) return;
    try {
      await connection.start();
      h.resync(); // anything that happened while we were not connected
    } catch {
      if (!stopped) retry = setTimeout(() => void connect(), 15_000);
    }
  };
  // Automatic reconnect gives up after its last pause (or when the server closed us because the token expired): keep trying slowly.
  connection.onclose(() => {
    if (!stopped) retry = setTimeout(() => void connect(), 5_000);
  });

  const onOnline = () => void connect();
  window.addEventListener("online", onOnline);
  void connect();

  return () => {
    stopped = true;
    clearTimeout(retry);
    window.removeEventListener("online", onOnline);
    void connection.stop();
  };
}
