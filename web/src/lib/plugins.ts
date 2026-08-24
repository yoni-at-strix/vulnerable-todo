import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PluginConfig {
  renderers: Record<string, string>;
}

function loadConfig(): PluginConfig {
  const raw = readFileSync(resolve(import.meta.dirname, "../../config/plugins.json"), "utf8");
  return JSON.parse(raw) as PluginConfig;
}

/**
 * Renderers are chosen by name at runtime. The module id comes out of the
 * config file, so nothing in this file names a package: swapping the renderer
 * is a config change, not a code change.
 */
export async function loadRenderer(kind: string): Promise<((tpl: string, ctx: unknown) => string) | null> {
  const config = loadConfig();
  const moduleId = config.renderers[kind];
  if (!moduleId) return null;

  const mod = await import(moduleId);
  const factory = mod.default ?? mod;
  if (typeof factory.compile !== "function") return null;

  return (tpl: string, ctx: unknown) => factory.compile(tpl)(ctx);
}
