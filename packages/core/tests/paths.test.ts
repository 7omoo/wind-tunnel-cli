import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configRoot, dataRoot, runsRoot } from "../src/run/paths";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("XDG locations", () => {
  it("uses XDG_DATA_HOME / XDG_CONFIG_HOME when set", () => {
    vi.stubEnv("XDG_DATA_HOME", "/data");
    vi.stubEnv("XDG_CONFIG_HOME", "/config");
    expect(dataRoot()).toBe(join("/data", "wind-tunnel"));
    expect(runsRoot()).toBe(join("/data", "wind-tunnel", "runs"));
    expect(configRoot()).toBe(join("/config", "wind-tunnel"));
  });

  // The XDG spec treats an empty value as unset.
  it("falls back to ~/.local/share and ~/.config when unset or blank", () => {
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "   ");
    expect(dataRoot()).toBe(join(homedir(), ".local", "share", "wind-tunnel"));
    expect(configRoot()).toBe(join(homedir(), ".config", "wind-tunnel"));
  });
});
