/**
 * Signing for commands made offline. Each device holds a private key per person that never leaves it (non-extractable);
 * the server holds the matching public key (registered while online) and checks every command against it.
 * Must match the server: SyncService.SigningMessage, ECDSA P-256 / SHA-256, IEEE P1363 (r||s) signatures, SPKI base64 public keys.
 */
export interface SignedPart {
  deviceId: string;
  /** ISO time the command was made on the device. */
  capturedAt: string;
  /** The exact JSON text that was signed. It is sent as text so nothing can reorder or reformat it. */
  payloadJson: string;
  /** Base64 signature. */
  signature: string;
}

export const signingMessage = (
  id: string,
  type: string,
  userId: string,
  deviceId: string,
  capturedAt: string,
  payloadJson: string,
) =>
  `gilded-cmd-v1\n${id}\n${type}\n${userId}\n${deviceId}\n${capturedAt}\n${payloadJson}`;

const ALGO = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

export const toBase64 = (buf: ArrayBuffer) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};

/** The private key cannot be exported; the public key can. */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGO, false, ["sign", "verify"]);
}

export async function publicKeyBase64(key: CryptoKey): Promise<string> {
  return toBase64(await crypto.subtle.exportKey("spki", key));
}

export async function signText(
  privateKey: CryptoKey,
  text: string,
): Promise<string> {
  return toBase64(
    await crypto.subtle.sign(SIGN, privateKey, new TextEncoder().encode(text)),
  );
}

export async function signCommand(
  privateKey: CryptoKey,
  c: {
    id: string;
    type: string;
    userId: string;
    deviceId: string;
    capturedAt: string;
    payload: unknown;
  },
): Promise<SignedPart> {
  const payloadJson = JSON.stringify(c.payload);
  const signature = await signText(
    privateKey,
    signingMessage(
      c.id,
      c.type,
      c.userId,
      c.deviceId,
      c.capturedAt,
      payloadJson,
    ),
  );
  return {
    deviceId: c.deviceId,
    capturedAt: c.capturedAt,
    payloadJson,
    signature,
  };
}

/** Used by tests (and by a branch computer later) to check a signature the way the server does. */
export async function verifyText(
  publicKey: CryptoKey,
  text: string,
  signatureB64: string,
): Promise<boolean> {
  const sig = Uint8Array.from(atob(signatureB64), (ch) => ch.charCodeAt(0));
  return crypto.subtle.verify(
    SIGN,
    publicKey,
    sig,
    new TextEncoder().encode(text),
  );
}
