import { WORDLIST } from "./wordlist.ts";
import { ROOM_WORD_COUNT, PASSPHRASE_WORD_COUNT } from "$lib/constants/id.ts";

const WORDLIST_MASK = WORDLIST.length - 1; // 0x7FF — works because length is 2048 (2^11)

/**
 * Pick `count` random words from WORDLIST using crypto.getRandomValues().
 * Each word needs 11 bits; we read 16-bit values and mask to avoid modulo bias.
 */
function pickRandomWords(count: number): string[] {
  const random_values = new Uint16Array(count * 2); // over-sample to handle rejection
  crypto.getRandomValues(random_values);

  const words: string[] = [];
  let value_index = 0;

  while (words.length < count) {
    if (value_index >= random_values.length) {
      // Exhausted buffer — refill (extremely rare path)
      crypto.getRandomValues(random_values);
      value_index = 0;
    }
    const random_index = random_values[value_index]! & WORDLIST_MASK;
    value_index++;
    words.push(WORDLIST[random_index]!);
  }

  return words;
}

/**
 * Generate a random 3-word room ID using crypto.getRandomValues().
 * No network calls, no permissions required.
 * Returns a hyphen-separated string like "apple-river-moon".
 */
export function generateId(): string {
  return pickRandomWords(ROOM_WORD_COUNT).join("-");
}

/**
 * Generate a random 2-word passphrase for geo mode room security.
 * Returns a hyphen-separated string like "forest-table".
 */
export function generatePassphrase(): string {
  return pickRandomWords(PASSPHRASE_WORD_COUNT).join("-");
}

/**
 * Read the room ID from window.location.pathname.
 * Expects a path like "/apple-river-moon" — returns the ID without the leading slash,
 * or null if the path is empty or root.
 */
export function parseId(): string | null {
  const raw_path = window.location.pathname.replace(/^\//, "").trim();
  if (raw_path === "") {
    return null;
  }
  return raw_path;
}

/**
 * Validate that a string is a well-formed room ID:
 * exactly ROOM_WORD_COUNT words from WORDLIST, joined by hyphens.
 */
export function isValidId(candidate: string): boolean {
  const parts = candidate.split("-");
  if (parts.length !== ROOM_WORD_COUNT) {
    return false;
  }
  const wordlist_set = new Set(WORDLIST);
  return parts.every((part) => wordlist_set.has(part));
}
