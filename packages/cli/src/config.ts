// Configuration resolution: defaults < config.toml < WT_* environment < flags
// (docs/DESIGN.md §9). resolveConfig is pure for testability; loadConfig adds
// the file read.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  configRoot,
  countrySchema,
  DEFAULT_MODEL_ROLES,
  DEFAULT_SITUATION,
  type ModelRoles,
  outputLangSchema,
  situationSchema,
} from "@wind-tunnel/core";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

// Hybrid-profile default for the ~4 analysis/premium calls. Model names rot;
// `wt-cli init` writes explicit values into config.toml so users pin their own.
const HYBRID_ANALYSIS_MODEL = "gemini:gemini-3.1-pro-preview";

const fileSchema = z.object({
  profile: z.enum(["local", "hybrid"]).optional(),
  model: z
    .object({
      bulk: z.string().optional(),
      analysis: z.string().optional(),
      premium: z.string().optional(),
      gemini_api_key: z.string().optional(),
    })
    .optional(),
  run: z
    .object({
      country: countrySchema.optional(),
      personas: z.number().int().min(1).max(1000).optional(),
      batch: z.number().int().min(1).max(64).optional(),
      output_lang: outputLangSchema.optional(),
      situation: situationSchema.optional(),
    })
    .optional(),
  ollama: z.object({ host: z.string().optional() }).optional(),
});
export type FileConfig = z.infer<typeof fileSchema>;

// Flags a command may pass in (already typed by commander parsing).
export type CliFlags = {
  profile?: string;
  modelBulk?: string;
  modelAnalysis?: string;
  modelPremium?: string;
  country?: string;
  personas?: number;
  batch?: number;
  outputLang?: string;
  situation?: string;
  host?: string;
};

export type ResolvedConfig = {
  profile: "local" | "hybrid";
  models: ModelRoles;
  geminiApiKey?: string;
  ollamaHost?: string;
  run: {
    country: z.infer<typeof countrySchema>;
    personas: number;
    batch: number;
    outputLang: z.infer<typeof outputLangSchema>;
    situation: z.infer<typeof situationSchema>;
  };
};

function intFrom(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

export function resolveConfig(opts: {
  fileText?: string;
  env?: Record<string, string | undefined>;
  flags?: CliFlags;
}): ResolvedConfig {
  const env = opts.env ?? {};
  const flags = opts.flags ?? {};

  let file: FileConfig = {};
  if (opts.fileText) {
    const parsed = fileSchema.safeParse(parseToml(opts.fileText));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `invalid config.toml: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "parse error"}`,
      );
    }
    file = parsed.data;
  }

  const profile = z
    .enum(["local", "hybrid"])
    .parse(flags.profile ?? env.WT_PROFILE ?? file.profile ?? "local");

  // Model roles: profile picks the defaults, explicit settings win per role.
  const profileDefaults: ModelRoles =
    profile === "hybrid"
      ? {
          bulk: DEFAULT_MODEL_ROLES.bulk,
          analysis: HYBRID_ANALYSIS_MODEL,
          premium: HYBRID_ANALYSIS_MODEL,
        }
      : DEFAULT_MODEL_ROLES;
  const models: ModelRoles = {
    bulk: flags.modelBulk ?? env.WT_MODEL_BULK ?? file.model?.bulk ?? profileDefaults.bulk,
    analysis:
      flags.modelAnalysis ??
      env.WT_MODEL_ANALYSIS ??
      file.model?.analysis ??
      profileDefaults.analysis,
    premium:
      flags.modelPremium ?? env.WT_MODEL_PREMIUM ?? file.model?.premium ?? profileDefaults.premium,
  };

  const country = countrySchema.parse(
    flags.country ?? env.WT_COUNTRY ?? file.run?.country ?? "usa",
  );
  // Analysis language follows the pool's country unless set explicitly, so the
  // default experience is monolingual end to end (usa -> en, jp -> ja, ...).
  const derivedOutputLang = country === "jp" ? "ja" : "en";
  const personas =
    intFrom(flags.personas, "--personas") ??
    intFrom(env.WT_PERSONAS, "WT_PERSONAS") ??
    file.run?.personas ??
    100;
  if (personas > 1000) throw new Error("--personas must be 1000 or fewer");
  const batch =
    intFrom(flags.batch, "--batch") ?? intFrom(env.WT_BATCH, "WT_BATCH") ?? file.run?.batch ?? 5;
  if (batch > 64) throw new Error("--batch must be 64 or fewer");
  const outputLang = outputLangSchema.parse(
    flags.outputLang ?? env.WT_OUTPUT_LANG ?? file.run?.output_lang ?? derivedOutputLang,
  );
  const situation = situationSchema.parse(
    flags.situation ?? env.WT_SITUATION ?? file.run?.situation ?? DEFAULT_SITUATION,
  );

  // Ollama host: flag > WT_OLLAMA_HOST > OLLAMA_HOST (ollama CLI convention) > file.
  const rawHost = flags.host ?? env.WT_OLLAMA_HOST ?? env.OLLAMA_HOST ?? file.ollama?.host;
  const ollamaHost = rawHost
    ? rawHost.startsWith("http")
      ? rawHost
      : `http://${rawHost}`
    : undefined;

  const geminiApiKey = env.GEMINI_API_KEY ?? env.WT_GEMINI_API_KEY ?? file.model?.gemini_api_key;

  return {
    profile,
    models,
    ...(geminiApiKey ? { geminiApiKey } : {}),
    ...(ollamaHost ? { ollamaHost } : {}),
    run: { country, personas, batch, outputLang, situation },
  };
}

export function configFilePath(): string {
  return join(configRoot(), "config.toml");
}

export async function loadConfig(flags?: CliFlags): Promise<ResolvedConfig> {
  let fileText: string | undefined;
  try {
    fileText = await readFile(configFilePath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return resolveConfig({ fileText, env: process.env, flags });
}
