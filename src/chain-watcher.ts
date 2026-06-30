import {
  proxyActivities,
  defineSignal,
  setHandler,
  defineQuery,
  condition,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import { Player } from "./types";

const { fetchChainState } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

// --- Signal definitions ---
const joinSignal = defineSignal<[Player]>("join");
const leaveSignal = defineSignal<[number]>("leave");
const hitConfirmSignal = defineSignal<[number]>("hitConfirm");

// --- Query definition (output: something the outside world reads OUT) ---
const getQueueQuery = defineQuery<Player[]>("getQueue");

export async function chainWatcherWorkflow(apiKey: string) {
  // --- State ---
  const queue: Player[] = [];
  let changed = false;
  let lastSeenCurrent = 0;

  // --- Query handler: return the current queue (front = whose turn) ---
  setHandler(getQueueQuery, () => queue);

  // --- Signal handlers ---
  setHandler(joinSignal, (player: Player) => {
    queue.push(player); // back of the queue
    changed = true;
  });

  setHandler(leaveSignal, (tornId: number) => {
    const index = queue.findIndex((p) => p.tornId === tornId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
    changed = true;
  });

  setHandler(hitConfirmSignal, (tornId: number) => {
    const index = queue.findIndex((p) => p.tornId === tornId);
    if (index !== -1) {
      const player = queue[index];
      player.hitsRemaining -= 1;
      queue.splice(index, 1); 
      if (player.hitsRemaining > 0) {
        queue.push(player); // only adds when player has hits
        // somehow notify player of this change
      }
    }
    changed = true;
  });

  // --- Polling loop comes in piece 2 ---
  // TEMPORARY: park here so the workflow stays alive for signal/query testing
  // via the Temporal UI. condition(() => false) never resolves, so it waits
  // indefinitely. This entire wait gets replaced by the real polling loop in
  // piece 2.
  await condition(() => false);
}