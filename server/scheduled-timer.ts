// Injectable timer abstraction (v0.52.0).
//
// The scheduled-refresh loop must be unit-testable without touching a real
// `setInterval` or any wall-clock wait. The codebase has no existing
// timer/scheduler abstraction (only the lone abort `setTimeout` in
// `server/index.ts`); `ProviderAdapterClock` is a *clock*, not a *scheduler*,
// and is injected separately. This module is that missing seam.
//
// `createRealTimer()` is the production binding: a single `setInterval` whose
// handle is `.unref()`-ed so an idle scheduler never keeps the process alive
// (graceful exit works even without the SIGINT/SIGTERM handler). The test
// double `createManualTimer()` records the registration and fires the tick
// synchronously via `.tick()` — zero real timers, zero wall-clock.

export interface TimerHandle {
  /** Idempotent: stopping an already-stopped handle is a no-op. */
  stop(): void;
}

export interface SchedulerTimer {
  schedule(intervalMs: number, onTick: () => void): TimerHandle;
}

export function createRealTimer(): SchedulerTimer {
  return {
    schedule(intervalMs: number, onTick: () => void): TimerHandle {
      const handle = setInterval(onTick, intervalMs);
      // Do not let a pending interval pin the event loop open on shutdown.
      handle.unref();
      let stopped = false;
      return {
        stop(): void {
          if (stopped) return;
          stopped = true;
          clearInterval(handle);
        },
      };
    },
  };
}

export interface ManualTimer extends SchedulerTimer {
  /** Synchronously invoke the registered tick (no-op once stopped). */
  tick(): void;
  /** How many times `schedule` was called (tests assert 0 or 1). */
  scheduleCalls: number;
  /** Interval passed to the most recent `schedule` call, or null. */
  lastIntervalMs: number | null;
}

export function createManualTimer(): ManualTimer {
  let registered: (() => void) | null = null;
  let stopped = false;
  const timer: ManualTimer = {
    scheduleCalls: 0,
    lastIntervalMs: null,
    schedule(intervalMs: number, onTick: () => void): TimerHandle {
      timer.scheduleCalls += 1;
      timer.lastIntervalMs = intervalMs;
      registered = onTick;
      stopped = false;
      return {
        stop(): void {
          stopped = true;
        },
      };
    },
    tick(): void {
      if (stopped || registered === null) return;
      registered();
    },
  };
  return timer;
}
