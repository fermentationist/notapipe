// In-memory sliding window rate limiter for join attempts per IP address.
// Defends against brute-force of geo mode passphrase-derived room IDs.

const WINDOW_MS = 60_000; // 1 minute
const MAX_JOINS_PER_WINDOW = 10;

// Map of IP address → array of attempt timestamps (ms)
const attempt_timestamps = new Map<string, number[]>();

/**
 * Record a join attempt for the given IP address.
 * Returns true if the attempt is allowed, false if the rate limit is exceeded.
 */
export function checkRateLimit(ip_address: string): boolean {
  const now = Date.now();
  const window_start = now - WINDOW_MS;

  const timestamps = attempt_timestamps.get(ip_address) ?? [];

  // Prune timestamps outside the sliding window
  const recent_timestamps = timestamps.filter((timestamp) => timestamp > window_start);

  if (recent_timestamps.length >= MAX_JOINS_PER_WINDOW) {
    // Update pruned list without recording this attempt
    attempt_timestamps.set(ip_address, recent_timestamps);
    return false;
  }

  recent_timestamps.push(now);
  attempt_timestamps.set(ip_address, recent_timestamps);
  return true;
}

/**
 * Remove all rate limit state for an IP address.
 * Useful in tests or if an IP is known to be clean.
 */
export function clearRateLimitState(ip_address: string): void {
  attempt_timestamps.delete(ip_address);
}

/**
 * Remove all rate limit state globally.
 * Intended for use in tests only.
 */
export function resetAllRateLimitState(): void {
  attempt_timestamps.clear();
}
