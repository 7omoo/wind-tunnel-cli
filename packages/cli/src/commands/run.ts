// `wt-cli run "<message>"` — the full pipeline against a persona pool.
// Until `personas pull` lands, the pool comes from --personas-file (a JSON
// pool, same format custom datasets will use).

import {
  createPipelineModels,
  dataRoot,
  defaultPersonaLang,
  defaultPoolPath,
  diagnoseOllama,
  executeRun,
  loadJsonPersonaSource,
  type ModelRoles,
  newRunId,
  openPersonaPool,
  type PersonaPool,
  type PersonaSource,
  parseModelSpec,
  poolExists,
  type RunInput,
  RunStore,
  runsRoot,
  topicSchema,
} from "@wind-tunnel/core";
import { type CliFlags, loadConfig, type ResolvedConfig } from "../config";
import { paint, useColor } from "../render/format";
import { createProgressRenderer } from "../render/progress";
import { renderSummary } from "../render/summary";

export type RunFlags = CliFlags & {
  personasFile?: string;
  context?: string;
  region?: string;
  ageMin?: number;
  ageMax?: number;
  sex?: string;
};

// Fail before spending any time: unreachable daemon, missing models, missing
// API key. Prints the exact fix and returns false.
export async function preflightModels(
  models: ModelRoles,
  cfg: Pick<ResolvedConfig, "geminiApiKey" | "ollamaHost">,
  stderr: NodeJS.WriteStream = process.stderr,
): Promise<boolean> {
  const specs = Object.values(models).map(parseModelSpec);
  const problems: string[] = [];

  if (specs.some((s) => s.provider === "gemini") && !cfg.geminiApiKey) {
    problems.push(
      "a gemini model is configured but no API key is set — set GEMINI_API_KEY or [model] gemini_api_key in config.toml",
    );
  }

  if (specs.some((s) => s.provider === "ollama")) {
    const report = await diagnoseOllama({ baseUrl: cfg.ollamaHost, roles: models });
    if (!report.reachable) {
      problems.push(
        `Ollama daemon not reachable at ${report.baseUrl} — start it (brew services start ollama / ollama serve); not installed? https://ollama.com/download`,
      );
    } else {
      for (const check of report.roleChecks) {
        if (check.installed === false) {
          problems.push(
            `model for ${check.role} not installed — run: ollama pull ${check.pullName}`,
          );
        }
      }
    }
  }

  for (const p of problems) {
    stderr.write(`${paint("red", "✗", useColor(stderr))} ${p}\n`);
  }
  return problems.length === 0;
}

// Resume never re-samples (personas.json already exists); reaching the filter
// stage without a real source means the run directory was tampered with.
const NO_SOURCE: PersonaSource = {
  sample: async () => {
    throw new Error("persona sampling is only available through `wt-cli run`");
  },
  poolVersion: async () => "unknown",
};

export async function runCommand(message: string, flags: RunFlags): Promise<number> {
  const stderr = process.stderr;
  const color = useColor(stderr);
  let pool: PersonaPool | undefined;
  try {
    const topic = topicSchema.parse(message);
    const cfg = await loadConfig(flags);

    // Persona source: an explicit JSON pool wins; otherwise the local pool
    // database written by `personas pull`.
    let source: PersonaSource;
    if (flags.personasFile) {
      source = await loadJsonPersonaSource(flags.personasFile);
    } else {
      const poolPath = defaultPoolPath(dataRoot());
      const pullHint = `wt-cli personas pull ${cfg.run.country}`;
      if (!(await poolExists(poolPath))) {
        throw new Error(`no persona pool installed — run: ${pullHint} (or pass --personas-file)`);
      }
      pool = await openPersonaPool(poolPath);
      if ((await pool.poolVersion(cfg.run.country)).startsWith("none-")) {
        throw new Error(`country "${cfg.run.country}" is not in the pool — run: ${pullHint}`);
      }
      source = pool;
    }

    if (!(await preflightModels(cfg.models, cfg, stderr))) return 1;

    const input: RunInput = {
      schemaVersion: 1,
      runId: newRunId(),
      createdAt: new Date().toISOString(),
      topic,
      country: cfg.run.country,
      situation: cfg.run.situation,
      // Reaction language follows the pool's country (docs/DESIGN.md §9).
      personaLang: defaultPersonaLang(cfg.run.country),
      outputLang: cfg.run.outputLang,
      ...(flags.context ? { context: flags.context } : {}),
      filter: {
        personaCount: cfg.run.personas,
        ...(flags.region ? { region: flags.region } : {}),
        ...(flags.ageMin !== undefined ? { ageMin: flags.ageMin } : {}),
        ...(flags.ageMax !== undefined ? { ageMax: flags.ageMax } : {}),
        ...(flags.sex ? { sex: flags.sex } : {}),
      },
      models: cfg.models,
      batch: cfg.run.batch,
    };

    const store = await RunStore.create(runsRoot(), input);
    stderr.write(`${paint("dim", `run ${input.runId}`, color)}\n`);

    return await executeAndRender(store, cfg, stderr, source);
  } catch (e) {
    stderr.write(`${paint("red", "✗", color)} ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  } finally {
    pool?.close();
  }
}

// Shared by run and resume: models, renderer, execution, summary.
export async function executeAndRender(
  store: RunStore,
  cfg: Pick<ResolvedConfig, "geminiApiKey" | "ollamaHost">,
  stderr: NodeJS.WriteStream,
  source: PersonaSource = NO_SOURCE,
): Promise<number> {
  const color = useColor(stderr);
  const input = await store.readInput();
  const models = await createPipelineModels(input.models, {
    ...(cfg.ollamaHost ? { ollamaBaseUrl: cfg.ollamaHost } : {}),
    ...(cfg.geminiApiKey ? { geminiApiKey: cfg.geminiApiKey } : {}),
  });

  const renderer = createProgressRenderer(stderr);
  const started = Date.now();
  try {
    const summary = await executeRun(store, { source, models, onEvent: renderer.onEvent });
    renderer.finish();

    renderSummary({
      input,
      runDir: store.dir,
      elapsedMs: Date.now() - started,
      opinions: await store.readOpinions(),
      scores: (await store.readScores())?.scores ?? [],
      verdict: (await store.readAnalyze()) ?? null,
      cluster: (await store.readCluster()) ?? null,
      suggest: (await store.readSuggest()) ?? null,
      warnings: summary.warnings,
    });
    return 0;
  } catch (e) {
    renderer.finish();
    stderr.write(`${paint("red", "✗", color)} ${e instanceof Error ? e.message : String(e)}\n`);
    stderr.write(`${paint("dim", `resume with: wt-cli resume ${input.runId}`, color)}\n`);
    return 1;
  }
}
