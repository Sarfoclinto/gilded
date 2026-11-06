import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generate } from "selfsigned";

export interface HubCert {
  key: string;
  cert: string;
  /** SHA-256 of the certificate, upper-case hex without colons. Machines pin this at pairing. */
  fingerprint: string;
}

export const fingerprintOf = (certPem: string) =>
  new X509Certificate(certPem).fingerprint256.replace(/:/g, "").toUpperCase();

/**
 * The hub's own certificate, made once and kept in its data folder. Nobody else vouches for it: machines learn its fingerprint when
 * they pair (it is part of what the hub shows), and from then on they talk to nothing else.
 */
export async function loadOrCreateCert(dir: string): Promise<HubCert> {
  const keyFile = path.join(dir, "hub-key.pem");
  const certFile = path.join(dir, "hub-cert.pem");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    const cert = fs.readFileSync(certFile, "utf8");
    return {
      key: fs.readFileSync(keyFile, "utf8"),
      cert,
      fingerprint: fingerprintOf(cert),
    };
  }
  fs.mkdirSync(dir, { recursive: true });
  const p = await generate(
    [{ name: "commonName", value: "gilded-branch-hub" }],
    {
      keyType: "ec",
      notAfterDate: new Date(Date.now() + 10 * 365 * 86_400_000),
      algorithm: "sha256",
      // Marked as its own authority: machines trust exactly this certificate (see client.ts), and Electron's TLS only accepts a
      // pinned certificate as a trust anchor when it says it may act as one.
      extensions: [
        { name: "basicConstraints", cA: true, critical: true },
        {
          name: "keyUsage",
          keyCertSign: true,
          digitalSignature: true,
          keyEncipherment: true,
          critical: true,
        },
        { name: "extKeyUsage", serverAuth: true },
      ],
    },
  );
  fs.writeFileSync(keyFile, p.private, { mode: 0o600 });
  fs.writeFileSync(certFile, p.cert);
  return { key: p.private, cert: p.cert, fingerprint: fingerprintOf(p.cert) };
}
