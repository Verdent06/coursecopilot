#!/usr/bin/env node
import { Command } from "commander";
import { startStdio } from "./server/transport-stdio.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("coursecopilot")
  .description(
    "CourseCopilot MCP server — your classes, inside the AI you already use. No API key.",
  )
  .version(VERSION)
  .action(() => {
    startStdio();
  });

program.parse();
