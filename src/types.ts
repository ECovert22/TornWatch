// types.ts
//
// Shared data structures used by both activities and workflows. This file
// contains ONLY type definitions — no I/O, no fetch, no Node code — so it's
// always safe to import from workflow code (which runs in Temporal's
// deterministic sandbox) without pulling runtime dependencies into it.

// --- Torn API response shapes ---

export interface TornApiError {
  error: {
    code: number;
    error: string;
  };
}

export interface TornBar {
  current: number;
  maximum: number;
  increment: number;
  interval: number;
  tick_time: number;
  full_time: number;
}

export interface TornTravel {
  destination: string;
  method: string;
  departed_at: number;
  arrival_at: number;
  time_left: number;
}

export interface TornCooldowns {
  drug: number;
  medical: number;
  booster: number;
}

export interface TornBarsTravelCooldowns {
  bars: {
    energy: TornBar;
    nerve: TornBar;
  };
  travel: TornTravel;
  cooldowns: TornCooldowns;
}

export interface TornChainState {
  id: number;
  current: number;
  timeout: number;
}

export interface TornUserBasic {
  player_id: number;
  name: string;
  level: number;
}

// --- TornWatch domain types ---

export interface UpcomingEvent {
  name: string;
  secondsUntil: number;
}

export interface Player {
  tornId: number;           // stable, authoritative identifier
  name: string;             // display name for pings/logs
  discordId?: string;       // for the bot to @-mention later
  hitsRemaining: number;    // player input while joining
  // future: target assignment, FFScouter stats, etc.
}
