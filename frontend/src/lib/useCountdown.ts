import { useEffect, useState } from 'react';

/** Ticks a countdown (seconds) down to 0 from an initial snapshot; null when unavailable. */
export function useCountdown(initialSeconds: number | null | undefined): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (initialSeconds == null) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(initialSeconds);
    const t = setInterval(() => setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [initialSeconds]);
  return secondsLeft;
}
