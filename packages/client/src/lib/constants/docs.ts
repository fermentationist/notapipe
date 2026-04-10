import readmeRaw from "../../../../../README.md?raw";
import userGuideRaw from "../../../../../docs/user-guide.md?raw";

/**
 * Extract a single `## Heading` section from a markdown string.
 * Returns everything from the matching heading up to (but not including)
 * the next `##`-level heading, or to end-of-file if there is none.
 */
function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === `## ${heading}`);
  if (start === -1) {
    return markdown;
  }
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines
    .slice(start, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

export const USER_GUIDE_CONTENT: string = userGuideRaw;
export const ABOUT_CONTENT: string =
  extractSection(readmeRaw, "About notapipe") +
  "\n\n---\n\n" +
  "[View source on GitHub](https://github.com/fermentationist/notapipe)\n\n" +
  "&copy; 2025 [Dennis Hodges](https://dennis-hodges.com). MIT License.";
