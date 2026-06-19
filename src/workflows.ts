// workflows.ts
//
// This is the Workflow: the durable orchestration logic. It must be
// deterministic - no direct network calls, no Date.now(), no Math.random().
// Everything "real" happens through Activities, called via proxyActivities.

import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { fetchUserBasic } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

export async function getUserBasicWorkflow(apiKey: string) {
  const user = await fetchUserBasic(apiKey);
  return user;
}