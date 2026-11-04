import fs from "node:fs";
import path from "node:path";
import { normalizeServerUrl } from "./serverUrl";

export type Channel = "stable" | "beta";
export interface Config {
  serverUrl: string | null;
  channel: Channel;
}

const DEFAULTS: Config = { serverUrl: null, channel: "stable" };

/** Settings of this computer, kept in a small file in the app's data folder. */
export function readConfig(
  dir: string,
  defaults: Partial<Config> = {},
): Config {
  const base = { ...DEFAULTS, ...defaults };
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, "config.json"), "utf8"),
    ) as Partial<Config>;
    return {
      serverUrl:
        (raw.serverUrl && normalizeServerUrl(raw.serverUrl)) || base.serverUrl,
      channel: raw.channel === "beta" ? "beta" : base.channel,
    };
  } catch {
    return base;
  }
}

export function writeConfig(dir: string, cfg: Config) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));
}
