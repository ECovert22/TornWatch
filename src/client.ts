// client.ts
import "dotenv/config";

import { Connection, Client } from "@temporalio/client";
import { characterMonitorWorkflow } from "./character-monitor";

async function run() {
  const apiKey = process.env.TORN_API_KEY;
  if (!apiKey) {
    throw new Error("Set TORN_API_KEY environment variable before running.");
  }

  const connection = await Connection.connect({ address: "localhost:7233" });
  const client = new Client({ connection });

  const handle = await client.workflow.start(characterMonitorWorkflow, {
    args: [apiKey],
    taskQueue: "tornwatch",
    workflowId: `character-monitor-${Date.now()}`,
  });

  console.log(`Started workflow ${handle.workflowId}`);

 
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});