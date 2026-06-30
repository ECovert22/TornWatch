import {
  proxyActivities,
  defineSignal,
  setHandler,
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

export async function chainWatcherWorkflow(apiKey: string) {
  // --- State ---
  const queue: Player[] = [];
  let changed = false;
  let lastSeenCurrent = 0;

  // --- Signal handlers ---
  setHandler(joinSignal, (player: Player) => {
    // push to back of the rotation
    queue.push(player);
    changed = true;
  });

  setHandler(leaveSignal, (tornId: number) => {
    // remove the matching player, if present
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
        queue.splice(index,1);
        player.hitsRemaining-=1;

        if (player.hitsRemaining !== 0) {
            queue.push(player); //readd player if they still have hits
            // NOTE SEND A PING CONFIRMING THEY LEFT THE QUEUE IN THE FUTURE
        }
    }
    changed = true;
  });

  // (polling loop comes in piece 2)
}