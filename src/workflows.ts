import { proxyActivities, condition, defineSignal, setHandler } from "@temporalio/workflow";
import type * as activities from "./activities";

const somethingChangedSignal = defineSignal<[]>("somethingChanged");

const { fetchUpcomingEvents, sendNotification } = proxyActivities<typeof activities>({
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

  const readyDuringFlight = new Set<string>();

  while (true) {
    const events = await fetchUpcomingEvents(apiKey);


    // FUTURE: on landing, the travel stat fires its own "travel is ready"
    // notification AND the landing summary fires — two messages for one event.
    // Acceptable while these are console.logs; clean up when the real
    // notification layer exists (likely suppress the standalone travel
    // notification when a landing summary will cover it).
    const travelEvent = events.find((e) => e.name === "travel");
    const isTraveling = travelEvent !== undefined && travelEvent.secondsUntil > 0;

    // --- Decide notifications for this snapshot ---
    for (const event of events) {
      if (event.secondsUntil === 0) {
        if (!notified.has(event.name)) {

          
          const suppressedByTravel =
            isTraveling && event.name !== "travel" && event.name !== "drug";
          
            // transition INTO ready -> notify once, or wait for travel, then remember
          if (suppressedByTravel) {
            readyDuringFlight.add(event.name);
          } else {
            await sendNotification(`NOTIFY: ${event.name} is ready!`); // real notification activity goes here later
          }
          
          notified.add(event.name);
        }
        // else: already ready and already notified -> stay quiet
      } else {
        // counting down again -> clear memory so it can notify next time
        notified.delete(event.name);
      }
    }
    // detects when we landed, then 
    if (!isTraveling && readyDuringFlight.size > 0) {
      const landed = Array.from(readyDuringFlight).join(", ");
      await sendNotification(`NOTIFY: Landed! While flying, these became ready: ${landed}`);
      readyDuringFlight.clear();
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
