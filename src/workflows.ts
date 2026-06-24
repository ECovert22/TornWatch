import { proxyActivities, condition, defineSignal, setHandler } from "@temporalio/workflow";
import type * as activities from "./activities";

const somethingChangedSignal = defineSignal<[]>("somethingChanged");

const { fetchUpcomingEvents } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

export async function characterMonitorWorkflow(apiKey: string) {
  let changed = false;


  setHandler(somethingChangedSignal, () => {
    changed = true;
  });


  const notified = new Set<string>();

  while (true) {
    const events = await fetchUpcomingEvents(apiKey);

    // --- Decide notifications for this snapshot ---
    // Single source of truth for "what gets notified": no matter why we woke
    // up (timer, signal, or first run), every path arrives here.
    for (const event of events) {
      if (event.secondsUntil === 0) {
        if (!notified.has(event.name)) {
          // transition INTO ready -> notify once, then remember
          console.log(`NOTIFY: ${event.name} is ready!`); // real notification activity goes here later
          notified.add(event.name);
        }
        // else: already ready and already notified -> stay quiet
      } else {
        // counting down again -> clear memory so it can notify next time
        notified.delete(event.name);
      }
    }

    // --- Decide how long to wait ---
    // Only stats still counting down (secondsUntil > 0) are things to wait FOR.
    const countingDown = events.filter((e) => e.secondsUntil > 0);

    if (countingDown.length === 0) {
      // Nothing left to count down to: wait on the signal alone, no timeout.
      // condition() with no second argument waits indefinitely until the
      // predicate becomes true.
      await condition(() => changed);
      changed = false;
    } else {
      const soonest = Math.min(...countingDown.map((e) => e.secondsUntil));
      // THE RACE: wake when the signal flips `changed` first, OR when
      // `soonest` seconds elapse — whichever happens first.
      let wokenBySignal = await condition(() => changed, `${soonest} seconds`);

      while (wokenBySignal) {
        changed = false;
        wokenBySignal = await condition(() => changed, `60 seconds`);
      }
      // if the timeout fired instead, we just loop -> re-fetch -> the
      // now-ready stat gets caught by the notification block at the top.
    }
  }
}
