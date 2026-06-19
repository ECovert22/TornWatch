// client.ts

import { Connection, Client } from "@temporalio/client";
import { getUserBasicWorkflow } from "./workflows";

async function run() {
  const apiKey = process.env.TORN_API_KEY;
  if (!apiKey) {
    throw new Error("Set TORN_API_KEY environment variable before running.");
  }

  const connection = await Connection.connect({ address: "localhost:7233" });
  const client = new Client({ connection });

  const handle = await client.workflow.start(getUserBasicWorkflow, {
    args: [apiKey],
    taskQueue: "tornwatch",
    workflowId: `get-user-basic-${Date.now()}`,
  });

  console.log(`Started workflow ${handle.workflowId}`);

  const result = await handle.result();
  console.log("Workflow result:", result);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});