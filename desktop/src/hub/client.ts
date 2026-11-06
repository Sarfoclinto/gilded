import https from 'node:https';
import tls from 'node:tls';
import type { DrawerCommand, DrawerView } from '@gold/core';
import type { StoredEntry } from './store';
import type { CheckResult, SubmitResult } from './hub';
import type { PairedDevice } from './pairing';

export class HubError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
  /** The hub could not be reached (off, wrong network): the machine falls back to working alone. */
  get unreachable() {
    return this.status === 0 && this.code === 'UNREACHABLE';
  }
}

export interface HubLink {
  host: string;
  port: number;
  /** The hub's certificate, kept at pairing. This computer trusts this certificate and nothing else when talking to the hub. */
  certPem: string;
  /** Its SHA-256 fingerprint, for showing. */
  fingerprint: string;
  token: string;
}

const NOT_THE_HUB = 'The hub computer is not the one this computer was paired with.';
const NO_HUB = 'Cannot reach the hub computer.';

const toPem = (der: Buffer) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;

function mapError(e: unknown): HubError {
  if (e instanceof HubError) return e;
  const code = (e as { code?: string }).code ?? '';
  // A certificate that is not the pinned one fails the handshake before anything (the token included) is sent.
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|HOSTNAME_MISMATCH|ERR_SSL/.test(code)) return new HubError('CERT_CHANGED', NOT_THE_HUB);
  return new HubError('UNREACHABLE', NO_HUB);
}

/** Opens a connection only to look at the certificate the other end shows, and sends nothing. */
function probeCert(target: { host: string; port: number }, timeoutMs = 5000): Promise<{ pem: string; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: target.host, port: target.port, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = socket.getPeerCertificate();
      socket.destroy();
      if (!c?.raw) return reject(new HubError('CERT_CHANGED', NOT_THE_HUB));
      resolve({ pem: toPem(c.raw), fingerprint: c.fingerprint256.replace(/:/g, '').toUpperCase() });
    });
    socket.on('timeout', () => socket.destroy(new Error('TIMEOUT')));
    socket.on('error', (e) => reject(mapError(e)));
  });
}

function call<T>(target: { host: string; port: number; certPem: string }, opts: { method: string; path: string; token?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? null : JSON.stringify(opts.body);
    const req = https.request(
      {
        host: target.host,
        port: target.port,
        method: opts.method,
        path: opts.path,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        // Trust exactly the certificate pinned at pairing. Any other certificate fails the handshake, so nothing is sent to it.
        // Only the name check is skipped: the hub is reached by a branch address that no certificate authority would name.
        ca: target.certPem,
        rejectUnauthorized: true,
        checkServerIdentity: () => undefined,
        timeout: opts.timeoutMs ?? 5000,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let json: { data?: T; error?: { code: string; message: string } } = {};
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof json;
          } catch {
            /* handled below */
          }
          if (res.statusCode === 200 && json.data !== undefined) resolve(json.data);
          else reject(new HubError(json.error?.code ?? 'HUB_ERROR', json.error?.message ?? 'The hub gave an unexpected answer.', res.statusCode ?? 500));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', (e) => reject(mapError(e)));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * First contact with a hub, with the code and fingerprint start the hub showed. The certificate it presents must begin with that
 * fingerprint, so someone else on the network answering instead of the hub is turned away before the code is sent. The certificate is
 * then pinned, and the code goes over a connection that accepts only that certificate. Returns what to keep for next time.
 */
export async function pairWithHub(p: { host: string; port: number; code: string; fingerprintPrefix: string; deviceName: string }): Promise<HubLink & { branchId: string; hubName: string; deviceId: string }> {
  const seen = await probeCert(p);
  if (!seen.fingerprint.startsWith(p.fingerprintPrefix.toUpperCase())) throw new HubError('CERT_CHANGED', NOT_THE_HUB);
  const data = await call<{ token: string; deviceId: string; branchId: string; hubName: string }>({ host: p.host, port: p.port, certPem: seen.pem }, { method: 'POST', path: '/v1/pair', body: { code: p.code, deviceName: p.deviceName } });
  return { host: p.host, port: p.port, certPem: seen.pem, fingerprint: seen.fingerprint, token: data.token, deviceId: data.deviceId, branchId: data.branchId, hubName: data.hubName };
}

/** A paired computer's connection to its hub. Every call is made only to the pinned certificate. */
export class HubClient {
  constructor(private link: HubLink) {}
  private go<T>(method: string, path: string, body?: unknown, timeoutMs?: number) {
    return call<T>(this.link, { method, path, body, token: this.link.token, timeoutMs });
  }
  status() {
    return this.go<{ branchId: string; hubName: string; you: PairedDevice; view: DrawerView; lastSeq: number }>('GET', '/v1/status');
  }
  view() {
    return this.go<DrawerView>('GET', '/v1/view');
  }
  check(command: DrawerCommand) {
    return this.go<CheckResult>('POST', '/v1/check', { command });
  }
  submit(s: { command: DrawerCommand; userId: string; capturedAt: string; localSeq?: number; signed?: StoredEntry['signed']; strict?: boolean }) {
    return this.go<SubmitResult>('POST', '/v1/submit', s);
  }
  since(after: number) {
    return this.go<{ entries: StoredEntry[] }>('GET', `/v1/since?after=${after}`).then((r) => r.entries);
  }
  snapshot(state: unknown, asOf: string) {
    return this.go<{ accepted: boolean }>('POST', '/v1/snapshot', { state, asOf });
  }
}