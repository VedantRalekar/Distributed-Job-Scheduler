export function calculateRetryDelay(
  policy,
  attemptNo,
  random = Math.random
) {
  const base =
    policy?.base_delay_ms || 1000;

  const max =
    policy?.max_delay_ms || 60000;

  const strategy =
    policy?.backoff_strategy || 'exponential';

  let delay;

  if (strategy === 'fixed') {
    delay = base;
  } else if (strategy === 'linear') {
    delay = base * attemptNo;
  } else {
    delay =
      base *
      (2 ** Math.max(attemptNo - 1, 0));
  }

  delay = Math.min(delay, max);

  if (policy?.jitter) {
    delay = Math.floor(
      delay * (0.5 + random())
    );
  }

  return delay;
}