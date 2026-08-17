import { Command } from "commander";

const program = new Command();

program
  .name("windtunnel")
  .description("Simulate how hundreds of AI personas react to your message — locally")
  .version("0.1.0");

program.parse(process.argv);
