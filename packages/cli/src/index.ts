import { Command } from "commander";
import { runDoctor } from "./commands/doctor";
import { initCommand } from "./commands/init";
import { resumeCommand } from "./commands/resume";
import { runCommand } from "./commands/run";

const int = (value: string): number => Number.parseInt(value, 10);

const program = new Command();

program
  .name("windtunnel")
  .description("Simulate how hundreds of AI personas react to your message — locally")
  .version("0.1.0");

program
  .command("run")
  .description("Run the full pipeline: sample personas, react, analyze, cluster, suggest")
  .argument("<message>", "the draft message to test")
  .option("--country <code>", "persona pool country (jp, usa, in, br, fr, kr, vn, be)")
  .option("--personas <n>", "number of personas", int)
  .option("--batch <n>", "requests in flight for batched stages", int)
  .option("--situation <id>", "channel context (anon_board, sns_viral, news_comment, ...)")
  .option("--output-lang <lang>", "analysis output language (ja, en)")
  .option("--context <text>", "shared background text given to every persona")
  .option("--personas-file <path>", "JSON persona pool to sample from")
  .option("--region <name>", "restrict to a region of the pool")
  .option("--age-min <n>", "minimum persona age", int)
  .option("--age-max <n>", "maximum persona age", int)
  .option("--sex <value>", "restrict persona sex (M / F, matched against the pool)")
  .option("--profile <name>", "model profile (local, hybrid)")
  .option("--model-bulk <spec>", "bulk model (provider:model)")
  .option("--model-analysis <spec>", "analysis model (provider:model)")
  .option("--model-premium <spec>", "premium model (provider:model)")
  .option("--host <url>", "Ollama base URL")
  .action(async (message, opts) => {
    process.exitCode = await runCommand(message, opts);
  });

program
  .command("resume")
  .description("Continue an interrupted run from its checkpoint")
  .argument("<run-id>", "run id (or path to a run directory)")
  .option("--host <url>", "Ollama base URL")
  .action(async (idOrPath, opts) => {
    process.exitCode = await resumeCommand(idOrPath, opts);
  });

program
  .command("init")
  .description("Interactive setup: write config.toml")
  .action(async () => {
    process.exitCode = await initCommand();
  });

program
  .command("doctor")
  .description("Check Ollama reachability, role models, and effective parallelism")
  .option("--host <url>", "Ollama base URL (default: OLLAMA_HOST or http://localhost:11434)")
  .action(async (opts) => {
    process.exitCode = await runDoctor(opts);
  });

program.parse(process.argv);
