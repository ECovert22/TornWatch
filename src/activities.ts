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