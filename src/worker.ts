// worker.ts
//
// The Worker connects to the Temporal Service, polls for work, and executes
// our Workflow and Activity code.

import { Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve("./workflows"),
    activities,
    taskQueue: "tornwatch",
  });

  console.log("Worker started, polling task queue 'tornwatch'...");
  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});