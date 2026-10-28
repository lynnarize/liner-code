/* Small formatters the agent pieces share. */

/** 1.9s, 48s, 1m 05s. */
export const formatSeconds = (s: number) => (s < 10 ? `${s.toFixed(1)}s` : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`);
