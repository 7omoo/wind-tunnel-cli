// Environment diagnosis for the LM Studio side of a run, mirroring
// ollama/doctor.ts. Returns structured data; rendering belongs to the CLI.

import type { ModelRoles } from "../models/defaults";
import { parseModelSpec } from "../models/registry";
import { STAGE_NUM_CTX } from "../models/stages";
import { DEFAULT_LMSTUDIO_URL, getLmStudioLoadedContext, listLmStudioModels } from "./client";

// Context every LM Studio model must be loaded with: the largest stage budget.
// Ollama gets num_ctx per request; LM Studio only at load time, and a role's
// model may serve any of its stages, so one conservative floor applies to all.
export const LMSTUDIO_MIN_CONTEXT = Math.max(...Object.values(STAGE_NUM_CTX));

export type LmStudioRoleCheck = {
  role: string;
  spec: string;
  model: string; // the id after "lmstudio:", as `lms get` / /v1/models know it
  available: boolean;
  // Context it is loaded with; null = not loaded yet (it would be loaded on the
  // first request with LM Studio's default context, usually too small).
  loadedContext: number | null;
};

export type LmStudioDoctorReport = {
  baseUrl: string;
  reachable: boolean;
  models: string[];
  roleChecks: LmStudioRoleCheck[]; // lmstudio roles only
};

export async function diagnoseLmStudio(opts: {
  baseUrl?: string;
  roles: ModelRoles;
}): Promise<LmStudioDoctorReport> {
  const baseUrl = opts.baseUrl ?? DEFAULT_LMSTUDIO_URL;
  const models = await listLmStudioModels(baseUrl);
  const available = new Set(models ?? []);
  const lmstudioRoles = Object.entries(opts.roles).flatMap(([role, spec]) => {
    const parsed = parseModelSpec(spec);
    return parsed.provider === "lmstudio" ? [{ role, spec, model: parsed.name }] : [];
  });
  const roleChecks = await Promise.all(
    lmstudioRoles.map(async (r) => ({
      ...r,
      available: available.has(r.model),
      loadedContext: models === null ? null : await getLmStudioLoadedContext(r.model, baseUrl),
    })),
  );
  return { baseUrl, reachable: models !== null, models: models ?? [], roleChecks };
}

// True when the model must be (re)loaded with more context before a run:
// not loaded yet, or loaded below LMSTUDIO_MIN_CONTEXT.
export function needsLargerContext(check: LmStudioRoleCheck): boolean {
  return check.loadedContext === null || check.loadedContext < LMSTUDIO_MIN_CONTEXT;
}

// The command that fixes needsLargerContext.
export function loadCommand(check: LmStudioRoleCheck): string {
  return `lms load ${check.model} -c ${LMSTUDIO_MIN_CONTEXT}`;
}
