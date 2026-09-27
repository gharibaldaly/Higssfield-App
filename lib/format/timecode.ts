/** Film timecode for ad cuts: "00:04" for whole seconds, "00:04.5" when a cut falls between. */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds * 10) / 10);
  const minutes = Math.floor(safe / 60);
  const rest = Math.round((safe - minutes * 60) * 10) / 10;
  const whole = Math.floor(rest);
  const tenths = Math.round((rest - whole) * 10);
  const base = `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}`;
  return tenths > 0 ? `${base}.${tenths}` : base;
}

/** Start time of every shot, given each shot's duration in order. */
export function shotStarts(durations: number[]): number[] {
  const starts: number[] = [];
  let total = 0;
  for (const duration of durations) {
    starts.push(total);
    total += Math.max(0, duration);
  }
  return starts;
}
