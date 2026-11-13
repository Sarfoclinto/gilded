import https from "node:https";
import type { AddressInfo } from "node:net";
import type { DayStateLike, DrawerCommand } from "@gold/core";
import type { HubCert } from "./cert";
import type { Hub, Submission } from "./hub";
import type { Pairing } from "./pairing";

const MAX_BODY = 1_000_000;

type Json = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
/** A command the hub can keep. An opening or closing must have the parts everyone's drawer is worked out from. */
const isCommand = (c: unknown): c is DrawerCommand => {
  if (
    !isObject(c) ||
    typeof c.id !== "string" ||
    typeof c.type !== "string" ||
    !isObject(c.payload)
  )
    return false;
  const p = c.payload;
  if (c.type === "day.open")
    return (
      typeof p.id === "string" &&
      typeof p.branchId === "string" &&
      typeof p.businessDate === "string" &&
      isObject(p.lines)
    );
  if (c.type === "day.close")
    return (
      typeof p.dayId === "string" &&
      typeof p.branchId === "string" &&
      isObject(p.declared) &&
      isObject(p.declared.cash)
    );
  return true;
};

/**
 * The hub's door on the branch network. HTTPS only, with the hub's own certificate (machines pin it when they pair).
 * Everything except pairing needs the token a paired computer was given. The hub is never reachable from the internet by design:
 * it is a plain listener on the branch LAN and the installer does not open anything on the router.
 */
export function createHubServer(opts: {
  hub: Hub;
  pairing: Pairing;
  cert: HubCert;
  branchId: string;
  hubName: string;
}) {
  const { hub, pairing } = opts;

  const route = async (
    method: string,
    url: URL,
    body: Json,
    auth: string | null,
  ): Promise<unknown> => {
    if (method === "POST" && url.pathname === "/v1/pair") {
      const r = pairing.redeem(
        String(body.code ?? ""),
        String(body.deviceName ?? ""),
      );
      if (!r.ok) {
        const msg = {
          "bad-code": "That code is not right.",
          expired:
            "That code has expired. Ask for a new one on the hub computer.",
          locked:
            "Too many wrong tries. Ask for a new code on the hub computer.",
          full: "This branch already has the most computers it can have.",
        }[r.reason];
        throw new HttpError(
          r.reason === "bad-code" ? 403 : r.reason === "full" ? 409 : 410,
          r.reason.toUpperCase().replace("-", "_"),
          msg,
        );
      }
      return {
        token: r.token,
        deviceId: r.deviceId,
        branchId: opts.branchId,
        hubName: opts.hubName,
      };
    }

    const device = auth ? pairing.authenticate(auth) : null;
    if (!device)
      throw new HttpError(
        401,
        "NOT_PAIRED",
        "This computer is not paired with the hub.",
      );

    switch (`${method} ${url.pathname}`) {
      case "GET /v1/status":
        return {
          branchId: opts.branchId,
          hubName: opts.hubName,
          you: device,
          view: hub.view(),
          lastSeq: hub.since(0, 1_000_000).at(-1)?.seq ?? 0,
        };
      case "GET /v1/view":
        return hub.view();
      case "POST /v1/check": {
        if (!isCommand(body.command))
          throw new HttpError(422, "BAD_COMMAND", "The command is not valid.");
        return hub.check(body.command);
      }
      case "POST /v1/submit": {
        if (
          !isCommand(body.command) ||
          typeof body.capturedAt !== "string" ||
          typeof body.userId !== "string"
        )
          throw new HttpError(422, "BAD_COMMAND", "The command is not valid.");
        const s: Submission = {
          command: body.command,
          deviceId: device.id, // who sent it is decided by the token, not by what the sender says
          userId: body.userId,
          capturedAt: body.capturedAt,
          localSeq: typeof body.localSeq === "number" ? body.localSeq : 0,
          signed: (body.signed as Submission["signed"]) ?? null,
          strict: body.strict === true,
        };
        return hub.submit(s);
      }
      case "GET /v1/since": {
        const after = Number(url.searchParams.get("after") ?? 0);
        return { entries: hub.since(Number.isFinite(after) ? after : 0, 500) };
      }
      case "GET /v1/state":
        return hub.state();
      case "POST /v1/confirm": {
        if (!Array.isArray(body.ids) || typeof body.asOf !== "string")
          throw new HttpError(
            422,
            "BAD_CONFIRM",
            "The confirmation is not valid.",
          );
        return hub.confirm(body.ids as string[], body.asOf);
      }
      case "POST /v1/snapshot": {
        if (!body.state || typeof body.asOf !== "string")
          throw new HttpError(
            422,
            "BAD_SNAPSHOT",
            "The server answer is not valid.",
          );
        return {
          accepted: hub.setSnapshot(body.state as DayStateLike, body.asOf),
        };
      }
      default:
        throw new HttpError(404, "NOT_FOUND", "Unknown request.");
    }
  };

  const server = https.createServer(
    { key: opts.cert.key, cert: opts.cert.cert, minVersion: "TLSv1.2" },
    (req, res) => {
      const send = (status: number, payload: unknown) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(text),
          "Cache-Control": "no-store",
        });
        res.end(text);
      };
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          send(413, {
            error: { code: "TOO_LARGE", message: "Request too large." },
          });
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        void (async () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            let body: Json = {};
            if (raw) {
              try {
                body = JSON.parse(raw) as Json;
              } catch {
                throw new HttpError(
                  400,
                  "BAD_JSON",
                  "The request is not valid JSON.",
                );
              }
            }
            const bearer =
              /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ??
              null;
            const data = await route(
              req.method ?? "GET",
              new URL(req.url ?? "/", "https://hub"),
              body,
              bearer,
            );
            send(200, { data });
          } catch (e) {
            if (e instanceof HttpError)
              send(e.status, { error: { code: e.code, message: e.message } });
            else
              send(500, {
                error: {
                  code: "HUB_ERROR",
                  message: "The hub could not do that.",
                },
              });
          }
        })();
      });
    },
  );

  return {
    listen: (port: number, host = "0.0.0.0") =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () =>
          resolve((server.address() as AddressInfo).port),
        );
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
