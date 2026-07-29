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
    if (initialSeconds <= 0) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s == null) return s;
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [initialSeconds]);
  return secondsLeft;
}
