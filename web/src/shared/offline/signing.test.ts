import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  publicKeyBase64,
  signCommand,
  signingMessage,
  verifyText,
} from "./signing";

describe("signing", () => {
  const cmd = {
    id: "c1",
    type: "drawer.movement",
    userId: "u1",
    deviceId: "dev-12345678",
    capturedAt: "2026-01-01T10:00:00.000Z",
    payload: { a: 1, b: "x" },
  };

  it("signs the exact text the server rebuilds, and the signature checks out", async () => {
    const pair = await generateKeyPair();
    const s = await signCommand(pair.privateKey, cmd);
    expect(s.payloadJson).toBe('{"a":1,"b":"x"}');
    const text = signingMessage(
      cmd.id,
      cmd.type,
      cmd.userId,
      cmd.deviceId,
      cmd.capturedAt,
      s.payloadJson,
    );
    expect(text).toBe(
      'gilded-cmd-v1\nc1\ndrawer.movement\nu1\ndev-12345678\n2026-01-01T10:00:00.000Z\n{"a":1,"b":"x"}',
    );
    expect(await verifyText(pair.publicKey, text, s.signature)).toBe(true);
  });

  it("a changed payload no longer verifies", async () => {
    const pair = await generateKeyPair();
    const s = await signCommand(pair.privateKey, cmd);
    const tampered = signingMessage(
      cmd.id,
      cmd.type,
      cmd.userId,
      cmd.deviceId,
      cmd.capturedAt,
      '{"a":2,"b":"x"}',
    );
    expect(await verifyText(pair.publicKey, tampered, s.signature)).toBe(false);
  });

  it("another person's key does not verify", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const s = await signCommand(a.privateKey, cmd);
    const text = signingMessage(
      cmd.id,
      cmd.type,
      cmd.userId,
      cmd.deviceId,
      cmd.capturedAt,
      s.payloadJson,
    );
    expect(await verifyText(b.publicKey, text, s.signature)).toBe(false);
  });

  it("the private key cannot be exported; the public key is an SPKI string of the length the server accepts", async () => {
    const pair = await generateKeyPair();
    await expect(
      crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ).rejects.toThrow();
    const pub = await publicKeyBase64(pair.publicKey);
    expect(pub.length).toBeGreaterThanOrEqual(80);
    expect(pub.length).toBeLessThanOrEqual(400);
  });

  it("signature is 64 bytes (r||s)", async () => {
    const pair = await generateKeyPair();
    const s = await signCommand(pair.privateKey, cmd);
    expect(atob(s.signature).length).toBe(64);
  });
});
