// Tests may install a sink. Production has no sink, log, storage or UI output.
export type ParseTiming = { stage: string; elapsedMs: number };
let observer: ((timing: ParseTiming) => void) | undefined;
export function setParseTimingObserver(value?: (timing: ParseTiming) => void) { observer = value; }
export function parseTimer(stage: string) {
  const sink = observer;
  const started = performance.now();
  return () => { try { sink?.({ stage, elapsedMs: performance.now() - started }); } catch { /* diagnostics are optional */ } };
}
