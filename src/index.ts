import "dotenv/config";
import { createRuntime } from "@maiar-ai/core";
import { SQLiteProvider } from "@maiar-ai/memory-sqlite";
import { OpenAIProvider } from "@maiar-ai/model-openai";
import { PluginTerminal } from "@maiar-ai/plugin-terminal";
import { PluginTextGeneration } from "@maiar-ai/plugin-text";
import { PluginTime } from "@maiar-ai/plugin-time";
import { PluginExpress } from "@maiar-ai/plugin-express";
import path from "path";
import router from "./app";
import { PluginRSS } from "./plugins/rss-monitor";
// Create and start the agent
const runtime = createRuntime({
  model: new OpenAIProvider({
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY as string
  }),
  memory: new SQLiteProvider({
    dbPath: path.join(process.cwd(), "data", "conversations.db")
  }),
  plugins: [
    new PluginTextGeneration(),
    new PluginTime(),
    new PluginTerminal({
      user: "test",
      agentName: "maiar-starter"
    }),
    new PluginExpress({
      port: 3000,
      router: router
    }),
    new PluginRSS()
  ]
});

// Start the runtime
console.log("Starting agent...");
runtime.start().catch((error) => {
  console.error("Failed to start agent:", error);
  process.exit(1);
});

// Handle shutdown gracefully
process.on("SIGINT", async () => {
  console.log("Shutting down agent...");
  await runtime.stop();
  process.exit(0);
});