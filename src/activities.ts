// activities.ts
//
// Activities are where Temporal Workflows are allowed to do "real world" work:
// network calls, reading the clock, anything non-deterministic. The Workflow
// itself must stay deterministic so Temporal can safely replay it from
// history after a crash. Activities are the escape hatch for all of that.


export interface TornUserBasic {
  player_id: number;
  name: string;
  level: number;
}

export interface TornApiError {
  error: {
    code: number;
    error: string;
  };
}

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


interface TornBar {
  current: number;
  maximum: number;
  increment: number;
  interval: number;
  tick_time: number;
  full_time: number;
}

interface TornTravel {
  destination: string;
  method: string;
  departed_at: number;
  arrival_at: number;
  time_left: number;
}

interface TornCooldowns {
  drug: number;
  medical: number;
  booster: number;
}

interface TornBarsTravelCooldowns {
  bars: {
    energy: TornBar;
    nerve: TornBar;
  };
  travel: TornTravel;
  cooldowns: TornCooldowns;
}

export interface UpcomingEvent {
  name: string;        // e.g. "energy", "nerve", "travel", "drug"
  secondsUntil: number;
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
  // LEARNING NOTE (delete once understood):
  // The webhook URL is a secret (anyone with it can post to your channel),
  // so it's read from the environment, never hardcoded. process.env is the
  // same mechanism your API key uses. We read it INSIDE the activity (not at
  // import time) so a missing/changed value is caught when actually used.
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not set in the environment.");
  }

  // LEARNING NOTE: a Discord webhook expects a POST with JSON body { content }.
  // This is the same fetch() shape as the Torn call, but with method/headers/
  // body specified because we're SENDING data, not just GETting it.
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });

  // LEARNING NOTE: Discord returns a 2xx status on success and doesn't send
  // back useful JSON for a normal webhook post, so unlike the Torn activity
  // we check the HTTP status code rather than parsing the body for an "error"
  // field. Throwing here lets Temporal's retry policy handle transient
  // failures (e.g. Discord briefly unreachable).
  if (!response.ok) {
    throw new Error(`Discord webhook failed: HTTP ${response.status}`);
  }
}