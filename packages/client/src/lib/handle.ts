import { ADJECTIVES, NOUNS } from "./constants/wordlist.ts";

const HANDLE_STORAGE_KEY = "notapipe_handle";

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function generateHandle(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return capitalize(adj) + capitalize(noun);
}

/** Load handle from localStorage, generating a temporary one if absent. */
export function loadHandle(): string {
  const stored = localStorage.getItem(HANDLE_STORAGE_KEY);
  if (stored !== null && stored.trim().length > 0) {
    return stored;
  }
  return generateHandle();
}

export function saveHandle(handle: string): void {
  localStorage.setItem(HANDLE_STORAGE_KEY, handle);
}
