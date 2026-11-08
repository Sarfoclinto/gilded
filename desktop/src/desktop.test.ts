import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAsset } from "./assets";
import { adjustResponseHeaders, rewriteSetCookie } from "./cors";
import {
  isInsecure,
  isPrivateHost,
  mayTrustSelfSigned,
  normalizeServerUrl,
} from "./serverUrl";

describe("server address", () => {
  it("cleans what people type", () => {
    expect(normalizeServerUrl("gilded.acme.com")).toBe(
      "https://gilded.acme.com",
    );
    expect(normalizeServerUrl("  https://gilded.acme.com/api/v1/  ")).toBe(
      "https://gilded.acme.com",
    );
    expect(normalizeServerUrl("localhost")).toBe("http://localhost");
    expect(normalizeServerUrl("localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeServerUrl("localhostel.com")).toBe(
      "https://localhostel.com",
    );
    expect(normalizeServerUrl("http://192.168.1.10:8080/")).toBe(
      "http://192.168.1.10:8080",
    );
  });
  it("refuses nonsense", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("ftp://x.com")).toBeNull();
    expect(normalizeServerUrl("http://")).toBeNull();
  });
  it("flags plain http over the internet only", () => {
    expect(isInsecure("https://a.com")).toBe(false);
    expect(isInsecure("http://localhost:5080")).toBe(false);
    expect(isInsecure("http://192.168.0.5")).toBe(false);
    expect(isInsecure("http://gilded.acme.com")).toBe(true);
  });
});

describe("bundled files", () => {
  const root = path.resolve("/app/web");
  it("serves real files and gives screens the index page", () => {
    expect(resolveAsset(root, "/assets/app.js")).toBe(
      path.join(root, "assets", "app.js"),
    );
    expect(resolveAsset(root, "/transactions/new")).toBe(
      path.join(root, "index.html"),
    );
    expect(resolveAsset(root, "/")).toBe(path.join(root, "index.html"));
  });
  it("never leaves the build folder", () => {
    expect(resolveAsset(root, "/../secret.txt")).toBeNull();
    expect(resolveAsset(root, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(resolveAsset(root, "/a\0b.js")).toBeNull();
  });
});

describe("talking to the company server", () => {
  it("makes the refresh cookie usable across sites", () => {
    expect(
      rewriteSetCookie(
        "gold_rt=abc; path=/api/v1/auth; httponly; samesite=lax",
      ),
    ).toBe("gold_rt=abc; path=/api/v1/auth; httponly; SameSite=None; Secure");
    expect(rewriteSetCookie("a=b; Secure; SameSite=Strict")).toBe(
      "a=b; SameSite=None; Secure",
    );
  });
  it("allows only the app origin and answers preflight", () => {
    const r = adjustResponseHeaders(
      {
        "access-control-allow-origin": ["https://other"],
        "Set-Cookie": ["x=1; SameSite=Lax"],
      },
      "POST",
    );
    expect(r.headers["Access-Control-Allow-Origin"]).toEqual(["app://gilded"]);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.headers["Set-Cookie"]![0]).toContain("SameSite=None");
    const p = adjustResponseHeaders({}, "OPTIONS", {
      "Access-Control-Request-Headers": "content-type,x-client-version",
    });
    expect(p.statusLine).toBe("HTTP/1.1 204 No Content");
    expect(p.headers["Access-Control-Allow-Headers"]).toEqual([
      "content-type,x-client-version",
    ]);
  });
});

describe("trusting a development certificate", () => {
  it("knows private addresses", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "10.0.0.4",
      "192.168.1.20",
      "172.16.5.5",
      "172.31.0.1",
      "laptop.local",
    ])
      expect(isPrivateHost(h)).toBe(true);
    for (const h of ["gilded.acme.com", "8.8.8.8", "172.32.0.1", "192.169.1.1"])
      expect(isPrivateHost(h)).toBe(false);
  });
  it("only for the configured https server, on a private address, when switched on", () => {
    const url = "https://192.168.1.20:5443";
    expect(mayTrustSelfSigned(url, "192.168.1.20", true)).toBe(true);
    expect(mayTrustSelfSigned(url, "192.168.1.20", false)).toBe(false); // not switched on
    expect(mayTrustSelfSigned(url, "192.168.1.21", true)).toBe(false); // some other machine
    expect(
      mayTrustSelfSigned("https://gilded.acme.com", "gilded.acme.com", true),
    ).toBe(false); // a real company server never qualifies
    expect(
      mayTrustSelfSigned("http://192.168.1.20:5080", "192.168.1.20", true),
    ).toBe(false); // plain http has nothing to trust
    expect(mayTrustSelfSigned(null, "x", true)).toBe(false);
  });
});
