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

