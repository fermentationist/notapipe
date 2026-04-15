import { WORDLIST } from "./wordlist.ts";
import { ROOM_WORD_COUNT, TOKEN_BYTE_LENGTH } from "$lib/constants/id.ts";

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

// ---------------------------------------------------------------------------
// Room token — URL fragment secret that prevents accidental room collisions
// ---------------------------------------------------------------------------

function bytesToToken(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generate a random URL-safe token (base64url, 8 bytes / ~11 chars).
 * Used as the URL fragment (#token) to prevent two strangers who happen to
 * share the same 3-word room ID from accidentally connecting to each other.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytesToToken(bytes);
}

/**
 * Read the existing token from window.location.hash.
 * If none is present, generate a fresh one and write it to the hash.
 * Always call this once on page load after the room ID is set.
 */
export function ensureToken(): string {
  const existing = window.location.hash.slice(1); // strip leading '#'
  if (existing !== "") {
    return existing;
  }
  const token = generateToken();
  history.replaceState(null, "", window.location.pathname + "#" + token);
  return token;
}

// Base path set at build time via VITE_BASE_PATH (e.g. "/notapipe/").
// Vite always normalises BASE_URL to end with "/".
const BASE_PATH = import.meta.env.BASE_URL as string;

/**
 * Read the room ID from window.location.pathname.
 * Strips the build-time base path prefix so that a deployment at /notapipe/
 * and one at / both return just "apple-river-moon".
 * Returns null if the path contains nothing beyond the base.
 */
export function parseId(): string | null {
  const pathname = window.location.pathname;
  // Strip the base prefix (case-sensitive, already normalised to end with "/")
  const relative = pathname.startsWith(BASE_PATH)
    ? pathname.slice(BASE_PATH.length)
    : pathname.replace(/^\//, "");
  const trimmed = relative.trim().replace(/^\//, "");
  if (trimmed === "") {
    return null;
  }
  return trimmed;
}

/**
 * Build a full pathname for a room ID, respecting the deployment base path.
 * e.g. roomPath("apple-river-moon") → "/notapipe/apple-river-moon"
 */
export function roomPath(room_id: string): string {
  // BASE_PATH ends with "/"; room_id has no leading slash.
  return `${BASE_PATH}${room_id}`;
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
