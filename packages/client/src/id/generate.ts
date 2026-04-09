import { WORDLIST } from "./wordlist.ts";
import { ROOM_WORD_COUNT, PASSPHRASE_WORD_COUNT, GEO_GRID_PRECISION, TOKEN_BYTE_LENGTH } from "$lib/constants/id.ts";

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
 * Derive a deterministic room ID from GPS coordinates.
 * Coordinates are snapped to a ~111 m grid (GEO_GRID_PRECISION degrees) before
 * hashing so that two nearby devices produce the same ID without exchanging data.
 * Returns a hyphen-separated 3-word string in the same format as generateId().
 *
 * The passphrase is NOT included in the hash — it is used as the URL fragment
 * token instead. This keeps room IDs purely location-derived while the passphrase
 * serves as the shared secret that prevents strangers in the same cell from connecting.
 *
 * Only call this when the user explicitly requests geo mode — it requires the
 * Geolocation permission and makes no network requests itself.
 */
export async function geoId(
  coords: { latitude: number; longitude: number },
): Promise<string> {
  const quantized_lat = Math.round(coords.latitude / GEO_GRID_PRECISION);
  const quantized_lon = Math.round(coords.longitude / GEO_GRID_PRECISION);

  const encoded = new TextEncoder().encode(`${quantized_lat},${quantized_lon}`);
  const hash_buffer = await crypto.subtle.digest("SHA-256", encoded);
  const hash_bytes = new Uint8Array(hash_buffer);

  const words: string[] = [];
  for (let i = 0; i < ROOM_WORD_COUNT; i++) {
    const byte_offset = i * 2;
    const value = ((hash_bytes[byte_offset]! << 8) | hash_bytes[byte_offset + 1]!) & WORDLIST_MASK;
    words.push(WORDLIST[value]!);
  }

  return words.join("-");
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
