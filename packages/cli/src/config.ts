// Configuration resolution: defaults < config.toml < WT_* environment < flags
// (docs/DESIGN.md §9). resolveConfig is pure for testability; loadConfig adds
// the file read. Every rejection is a CuratedError: it names the setting, the
// value and the fix, and the CLI prints it as written.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Country,
  CuratedError,
  configRoot,
  countrySchema,
  DEFAULT_MODEL_ROLES,
  DEFAULT_SITUATION,
  defaultOutputLang,
  type ModelRoles,
  type OutputLang,
  outputLangSchema,
  type ProviderSettings,
  type Situation,
  situationSchema,
} from "@wind-tunnel/core";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

// Hybrid-profile default for the ~4 analysis/premium calls. Model names rot;
// `wt-cli init` writes explicit values into config.toml so users pin their own.
const HYBRID_ANALYSIS_MODEL = "gemini:gemini-3.1-pro-preview";

const profileSchema = z.enum(["local", "hybrid"]);
export const PROFILE_OPTIONS = profileSchema.options;

// Upper bounds for the run settings, enforced on every source (file, env, flag).
const LIMITS = { personas: 1000, batch: 64 };

const fileSchema = z.object({
  profile: profileSchema.optional(),
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
      personas: z.number().int().min(1).max(LIMITS.personas).optional(),
      batch: z.number().int().min(1).max(LIMITS.batch).optional(),
      output_lang: outputLangSchema.optional(),
      situation: situationSchema.optional(),
    })
    .optional(),
  ollama: z.object({ host: z.string().optional() }).optional(),
  lmstudio: z.object({ host: z.string().optional() }).optional(),
});
type FileConfig = z.infer<typeof fileSchema>;

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
  profile: z.infer<typeof profileSchema>;
  models: ModelRoles;
  geminiApiKey?: string;
  ollamaHost?: string;
  lmstudioHost?: string;
  run: {
    country: Country;
    personas: number;
    batch: number;
    outputLang: OutputLang;
    situation: Situation;
  };
};

// The connection half of the config: what resume and doctor share with run.
export type ConnectionSettings = Pick<
  ResolvedConfig,
  "geminiApiKey" | "ollamaHost" | "lmstudioHost"
>;

// The same settings under the names the model registry uses.
export function providerSettings(cfg: ConnectionSettings): ProviderSettings {
  return {
    ...(cfg.ollamaHost ? { ollamaBaseUrl: cfg.ollamaHost } : {}),
    ...(cfg.lmstudioHost ? { lmstudioBaseUrl: cfg.lmstudioHost } : {}),
    ...(cfg.geminiApiKey ? { geminiApiKey: cfg.geminiApiKey } : {}),
  };
}

// Hosts may be given as "host:port"; the HTTP clients need a full base URL.
function withScheme(host: string | undefined): string | undefined {
  if (!host) return undefined;
  return host.startsWith("http") ? host : `http://${host}`;
}

function intFrom(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new CuratedError(`${label} must be a positive integer`);
  return n;
}

// A setting restricted to an enum. The rejection lists every valid option
// instead of surfacing zod's issue array as the message.
export function enumSetting<S extends z.ZodEnum>(
  schema: S,
  raw: unknown,
  label: string,
): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new CuratedError(`unknown ${label} "${raw}" — one of: ${schema.options.join(", ")}`);
}

export function resolveConfig(opts: {
  fileText?: string;
  // Where fileText came from; named in its error messages.
  configPath?: string;
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
      const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : "parse error";
      throw new CuratedError(`invalid ${opts.configPath ?? "config.toml"}: ${detail}`);
    }
    file = parsed.data;
  }

  const profile = enumSetting(
    profileSchema,
    flags.profile ?? env.WT_PROFILE ?? file.profile ?? "local",
    "profile",
  );

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

  const country = enumSetting(
    countrySchema,
    flags.country ?? env.WT_COUNTRY ?? file.run?.country ?? "usa",
    "country",
  );
  const personas =
    intFrom(flags.personas, "--personas") ??
    intFrom(env.WT_PERSONAS, "WT_PERSONAS") ??
    file.run?.personas ??
    100;
  if (personas > LIMITS.personas) {
    throw new CuratedError(`--personas must be ${LIMITS.personas} or fewer`);
  }
  const batch =
    intFrom(flags.batch, "--batch") ?? intFrom(env.WT_BATCH, "WT_BATCH") ?? file.run?.batch ?? 5;
  if (batch > LIMITS.batch) throw new CuratedError(`--batch must be ${LIMITS.batch} or fewer`);
  const outputLang = enumSetting(
    outputLangSchema,
    flags.outputLang ?? env.WT_OUTPUT_LANG ?? file.run?.output_lang ?? defaultOutputLang(country),
    "output language",
  );
  const situation = enumSetting(
    situationSchema,
    flags.situation ?? env.WT_SITUATION ?? file.run?.situation ?? DEFAULT_SITUATION,
    "situation",
  );

  // Ollama host: flag > WT_OLLAMA_HOST > OLLAMA_HOST (ollama CLI convention) > file.
  const ollamaHost = withScheme(
    flags.host ?? env.WT_OLLAMA_HOST ?? env.OLLAMA_HOST ?? file.ollama?.host,
  );
  // LM Studio host: WT_LMSTUDIO_HOST > file (no flag: --host stays Ollama's).
  const lmstudioHost = withScheme(env.WT_LMSTUDIO_HOST ?? file.lmstudio?.host);

  const geminiApiKey = env.GEMINI_API_KEY ?? env.WT_GEMINI_API_KEY ?? file.model?.gemini_api_key;

  return {
    profile,
    models,
    ...(geminiApiKey ? { geminiApiKey } : {}),
    ...(ollamaHost ? { ollamaHost } : {}),
    ...(lmstudioHost ? { lmstudioHost } : {}),
    run: { country, personas, batch, outputLang, situation },
  };
}

export function configFilePath(): string {
  return join(configRoot(), "config.toml");
}

export async function loadConfig(flags?: CliFlags): Promise<ResolvedConfig> {
  const configPath = configFilePath();
  let fileText: string | undefined;
  try {
    fileText = await readFile(configPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return resolveConfig({ fileText, configPath, env: process.env, flags });
}
