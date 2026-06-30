// activities.ts
//
// Activities are where Temporal Workflows are allowed to do "real world" work:
// network calls, reading the clock, anything non-deterministic. The Workflow
// itself must stay deterministic so Temporal can safely replay it from
// history after a crash. Activities are the escape hatch for all of that.


import { TornApiError, TornBarsTravelCooldowns, TornChainState, UpcomingEvent, TornUserBasic } from "./types";



const TORN_API_BASE = "https://api.torn.com/v2";

export async function fetchUserBasic(apiKey: string): Promise<TornUserBasic> {
  const url = `${TORN_API_BASE}/user?selections=basic&key=${apiKey}`;

  const response = await fetch(url);
  const data = (await response.json()) as TornUserBasic | TornApiError;

  if ("error" in data) {
    throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
  }

  return data;
}



export async function fetchUpcomingEvents(
  apiKey: string
): Promise<UpcomingEvent[]> {
  const url = `${TORN_API_BASE}/user?selections=bars,travel,cooldowns&key=${apiKey}`;

  const response = await fetch(url);
  const data = (await response.json()) as TornBarsTravelCooldowns | TornApiError;

  if ("error" in data) {
    throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
  }

  // Each data type given by the API is slightly different, here we translate it
  // everything downstream just sees uniform {name, secondsUntil}.
  const events: UpcomingEvent[] = [
    { name: "energy", secondsUntil: data.bars.energy.full_time },
    { name: "nerve", secondsUntil: data.bars.nerve.full_time },
    { name: "travel", secondsUntil: data.travel.time_left },
    { name: "drug", secondsUntil: data.cooldowns.drug },
    { name: "medical", secondsUntil: data.cooldowns.medical },
    { name: "booster", secondsUntil: data.cooldowns.booster },
  ];

  return events;
}


export async function sendNotification(message: string): Promise<void> {

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not set in the environment.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });


  if (!response.ok) {
    throw new Error(`Discord webhook failed: HTTP ${response.status}`);
  }
}



export async function fetchChainState(apiKey: string): Promise<TornChainState> {
  const url = `${TORN_API_BASE}/faction?selections=chain&key=${apiKey}`;

  const response = await fetch(url);
  const data = (await response.json()) as { chain: TornChainState } | TornApiError;

  if ("error" in data) {
    throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
  }


  return data.chain;
}