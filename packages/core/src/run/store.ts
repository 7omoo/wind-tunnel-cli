// Run directory access. Artifacts are the checkpoint: JSON files are written
// atomically (tmp + rename) so their presence is a reliable stage-completion
// marker, and opinions.jsonl is append-only so an interrupted react stage
// resumes from the personas not yet on disk.

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Opinion } from "../types";
import type {
  AnalyzeArtifact,
  ClusterArtifact,
  PersonasArtifact,
  RunInput,
  RunStageName,
  RunStatus,
  ScoresArtifact,
  SuggestArtifact,
} from "./types";

const FILES = {
  input: "input.json",
  status: "status.json",
  personas: "personas.json",
  opinions: "opinions.jsonl",
  scores: "scores.json",
  analyze: "analyze.json",
  cluster: "cluster.json",
  suggest: "suggest.json",
  csv: "result.csv",
} as const;

export class RunStore {
  private constructor(readonly dir: string) {}

  static async create(root: string, input: RunInput, now = new Date()): Promise<RunStore> {
    const dir = join(root, input.runId);
    await mkdir(dir, { recursive: true });
    const store = new RunStore(dir);
    await store.writeJson(FILES.input, input);
    const status: RunStatus = {
      schemaVersion: 1,
      stage: "filter",
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      error: null,
      warnings: [],
    };
    await store.writeJson(FILES.status, status);
    return store;
  }

  static async open(dir: string): Promise<RunStore> {
    const store = new RunStore(dir);
    await store.readInput(); // throws when this is not a run directory
    return store;
  }

  // --- generic helpers ---

  private path(name: string): string {
    return join(this.dir, name);
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    // Atomic within the same directory: a crash mid-write leaves the tmp file,
    // never a truncated artifact that resume would mistake for "stage done".
    const tmp = this.path(`.${name}.tmp`);
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, this.path(name));
  }

  private async readJson<T>(name: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.path(name), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }

  // --- input / status ---

  async readInput(): Promise<RunInput> {
    const input = await this.readJson<RunInput>(FILES.input);
    if (!input) throw new Error(`not a run directory (no input.json): ${this.dir}`);
    return input;
  }

  async readStatus(): Promise<RunStatus | undefined> {
    return this.readJson<RunStatus>(FILES.status);
  }

  async patchStatus(
    patch: Partial<Pick<RunStatus, "stage" | "completedAt" | "error">> & {
      addWarnings?: string[];
    },
    now = new Date(),
  ): Promise<RunStatus> {
    const current = (await this.readStatus()) ?? {
      schemaVersion: 1 as const,
      stage: "filter" as RunStageName,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      error: null,
      warnings: [],
    };
    const next: RunStatus = {
      ...current,
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      warnings: [...current.warnings, ...(patch.addWarnings ?? [])],
      updatedAt: now.toISOString(),
    };
    await this.writeJson(FILES.status, next);
    return next;
  }

  // --- stage artifacts ---

  async readPersonas(): Promise<PersonasArtifact | undefined> {
    return this.readJson<PersonasArtifact>(FILES.personas);
  }
  async writePersonas(artifact: PersonasArtifact): Promise<void> {
    await this.writeJson(FILES.personas, artifact);
  }

  async appendOpinion(opinion: Opinion): Promise<void> {
    await appendFile(this.path(FILES.opinions), `${JSON.stringify(opinion)}\n`, "utf8");
  }

  // Opinions written so far. A torn final line (crash mid-append) is skipped —
  // that persona simply reacts again on resume.
  async readOpinions(): Promise<Opinion[]> {
    let raw: string;
    try {
      raw = await readFile(this.path(FILES.opinions), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const opinions: Opinion[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        opinions.push(JSON.parse(trimmed) as Opinion);
      } catch {
        // torn line — ignore
      }
    }
    return opinions;
  }

  async readScores(): Promise<ScoresArtifact | undefined> {
    return this.readJson<ScoresArtifact>(FILES.scores);
  }
  async writeScores(artifact: ScoresArtifact): Promise<void> {
    await this.writeJson(FILES.scores, artifact);
  }

  async readAnalyze(): Promise<AnalyzeArtifact | undefined> {
    return this.readJson<AnalyzeArtifact>(FILES.analyze);
  }
  async writeAnalyze(artifact: AnalyzeArtifact): Promise<void> {
    await this.writeJson(FILES.analyze, artifact);
  }

  async readCluster(): Promise<ClusterArtifact | undefined> {
    return this.readJson<ClusterArtifact>(FILES.cluster);
  }
  async writeCluster(artifact: ClusterArtifact): Promise<void> {
    await this.writeJson(FILES.cluster, artifact);
  }

  async readSuggest(): Promise<SuggestArtifact | undefined> {
    return this.readJson<SuggestArtifact>(FILES.suggest);
  }
  async writeSuggest(artifact: SuggestArtifact): Promise<void> {
    await this.writeJson(FILES.suggest, artifact);
  }

  async writeCsv(text: string): Promise<void> {
    const tmp = this.path(`.${FILES.csv}.tmp`);
    await writeFile(tmp, text, "utf8");
    await rename(tmp, this.path(FILES.csv));
  }
}
