// `wt-cli personas pull <code>` / `wt-cli personas list` — manage the
// local persona pool.

import {
  COUNTRY_CODES,
  COUNTRY_LABELS,
  COUNTRY_PRESETS,
  countrySchema,
  dataRoot,
  defaultPoolPath,
  openPersonaPool,
  poolExists,
  pullCountryPool,
} from "@wind-tunnel/core";
import { renderError } from "../errors";
import { formatDuration, paint, useColor } from "../render/format";

export async function personasPullCommand(code: string, opts: { cap?: number }): Promise<number> {
  const stderr = process.stderr;
  const color = useColor(stderr);
  const parsed = countrySchema.safeParse(code);
  if (!parsed.success) {
    stderr.write(
      `${paint("red", "✗", color)} unknown country "${code}" — available: ${COUNTRY_CODES.join(", ")}\n`,
    );
    return 1;
  }
  const country = parsed.data;
  const preset = COUNTRY_PRESETS[country];
  const cap = opts.cap ?? preset.defaultCap;
  const started = Date.now();

  // Ctrl-C mid-pull is safe by design (the pool only changes in the final
  // transactional swap) — say so instead of dying silently.
  const onSigint = () => {
    stderr.write(`\n${paint("yellow", "✋", color)} pull interrupted — the pool is unchanged\n`);
    process.exit(130);
  };
  process.once("SIGINT", onSigint);

  stderr.write(
    `${paint("bold", "▸", color)} pulling ${COUNTRY_LABELS[country]} (${preset.datasetId}, cap ${cap}/region)\n`,
  );
  stderr.write(
    `${paint("dim", "  streams only the needed columns; stops as soon as every region is filled", color)}\n`,
  );

  try {
    const result = await pullCountryPool({
      country,
      poolPath: defaultPoolPath(dataRoot()),
      cap,
      onProgress: (p) => {
        if (p.type === "listing")
          stderr.write(`${paint("dim", "  listing dataset files…", color)}\n`);
        if (p.type === "file") {
          stderr.write(
            `  file ${p.index}/${p.total} — ${p.rows.toLocaleString()} rows, ${p.regions} regions (${formatDuration(Date.now() - started)})\n`,
          );
        }
        if (p.type === "swapping") stderr.write(`${paint("dim", "  writing pool…", color)}\n`);
      },
    });
    const regionSummary = Object.entries(result.regions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([r, n]) => `${r} ${n}`)
      .join(" · ");
    stderr.write(
      `${paint("green", "✓", color)} ${result.rows.toLocaleString()} personas across ${Object.keys(result.regions).length} regions in ${formatDuration(Date.now() - started)} (read ${result.filesRead}/${result.filesTotal} files)\n`,
    );
    stderr.write(
      `${paint("dim", `  ${regionSummary}${Object.keys(result.regions).length > 4 ? " · …" : ""}`, color)}\n`,
    );
    return 0;
  } catch (e) {
    renderError(e, stderr);
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

export async function personasListCommand(): Promise<number> {
  const stderr = process.stderr;
  const color = useColor(stderr);
  const path = defaultPoolPath(dataRoot());
  if (!(await poolExists(path))) {
    stderr.write(
      `no persona pool yet — run: wt-cli personas pull <code>  (${COUNTRY_CODES.join(", ")})\n`,
    );
    return 1;
  }
  const pool = await openPersonaPool(path);
  try {
    const infos = await pool.list();
    if (infos.length === 0) {
      stderr.write("pool database exists but no countries are ingested yet\n");
      return 1;
    }
    for (const info of infos) {
      const label = (COUNTRY_LABELS as Record<string, string>)[info.country] ?? info.country;
      process.stdout.write(
        `${info.country.padEnd(4)} ${label.padEnd(9)} ${String(info.rowCount).padStart(7)} personas   ${paint("dim", `${info.version} · ${info.ingestedAt.slice(0, 10)}`, color)}\n`,
      );
    }
    return 0;
  } finally {
    pool.close();
  }
}
