export const USER_GUIDE_URL =
  "https://raw.githubusercontent.com/fermentationist/notapipe/main/docs/user-guide.md";

export const README_URL =
  "https://raw.githubusercontent.com/fermentationist/notapipe/main/README.md";

/**
 * Extract a single `## Heading` section from a markdown string.
 * Returns everything from the matching heading up to (but not including)
 * the next `##`-level heading, or to end-of-file if there is none.
 */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === `## ${heading}`);
  if (start === -1) {
    return markdown;
  }
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines
    .slice(start, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}
