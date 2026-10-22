// `wt-cli init` — interactive first-run: write config.toml with explicit
// values (so model-name defaults are pinned in the user's file, not in code).

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  COUNTRY_CODES,
  COUNTRY_LABELS,
  countrySchema,
  DEFAULT_MODEL_ROLES,
  defaultOutputLang,
} from "@wind-tunnel/core";
import { stringify as stringifyToml } from "smol-toml";
import { configFilePath, enumSetting, resolveConfig } from "../config";
import { renderError } from "../errors";
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
    const exists = await access(path).then(
      () => true,
      () => false,
    );
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
    const country = enumSetting(countrySchema, await ask("default country?", "usa"), "country");
    const personas = await ask("personas per run?", "100");
    const batch = await ask("batch size (requests in flight)?", "5");
    const outputLang = await ask("analysis output language? [ja/en]", defaultOutputLang(country));
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
    const text = stringifyToml(config);
    resolveConfig({ fileText: text });

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${text}\n`, "utf8");
    process.stderr.write(`${paint("green", "✓", color)} wrote ${path}\n`);
    return 0;
  } catch (e) {
    renderError(e, process.stderr);
    return 1;
  } finally {
    rl.close();
  }
}
