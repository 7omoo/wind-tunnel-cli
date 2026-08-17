import { Command } from "commander";
import { runDoctor } from "./commands/doctor";

const program = new Command();

program
  .name("windtunnel")
  .description("Simulate how hundreds of AI personas react to your message — locally")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check Ollama reachability, role models, and effective parallelism")
  .option("--host <url>", "Ollama base URL (default: OLLAMA_HOST or http://localhost:11434)")
  .action(async (opts: { host?: string }) => {
    process.exitCode = await runDoctor(opts);
  });

program.parse(process.argv);
