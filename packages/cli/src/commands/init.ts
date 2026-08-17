// `windtunnel init` — interactive first-run: write config.toml with explicit
// values (so model-name defaults are pinned in the user's file, not in code).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { COUNTRY_CODES, COUNTRY_LABELS, DEFAULT_MODEL_ROLES } from "@wind-tunnel/core";
import { stringify as stringifyToml } from "smol-toml";
import { configFilePath, resolveConfig } from "../config";
import { paint, useColor } from "../render/format";

export async function initCommand(): Promise<number> {
  const color = useColor(process.stderr);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = async (question: string, fallback: string): Promise<string> => {
    const answer = (
      await rl.question(`${question} ${paint("dim", `(${fallback})`, color)} `)
    ).trim();
    return answer || fallback;
  };

  try {
    const path = configFilePath();
    let exists = false;
    try {
      await readFile(path, "utf8");
      exists = true;
    } catch {
      // no existing config
    }
    if (exists) {
      const overwrite = await ask(`${path} exists — overwrite? [y/N]`, "N");
      if (!/^y(es)?$/i.test(overwrite)) {
        process.stderr.write("aborted\n");
        return 1;
      }
    }

    process.stderr.write(
      `${paint("dim", `countries: ${COUNTRY_CODES.map((c) => `${c}=${COUNTRY_LABELS[c]}`).join(" ")}`, color)}\n`,
    );
    const country = await ask("default country?", "jp");
    const personas = await ask("personas per run?", "100");
    const batch = await ask("batch size (requests in flight)?", "5");
    const outputLang = await ask("analysis output language? [ja/en]", "ja");
    const bulk = await ask("bulk model (reactions, ~100 calls)?", DEFAULT_MODEL_ROLES.bulk);
    const analysis = await ask("analysis model (verdict, ~4 calls)?", DEFAULT_MODEL_ROLES.analysis);

    const config = {
      profile: "local",
      model: { bulk, analysis, premium: analysis },
      run: {
        country,
        personas: Number.parseInt(personas, 10),
        batch: Number.parseInt(batch, 10),
        output_lang: outputLang,
      },
    };

    // Validate through the same schema the loader uses — a config written by
    // init must always load.
    resolveConfig({ fileText: stringifyToml(config) });

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${stringifyToml(config)}\n`, "utf8");
    process.stderr.write(`${paint("green", "✓", color)} wrote ${path}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(
      `${paint("red", "✗", color)} ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  } finally {
    rl.close();
  }
}
