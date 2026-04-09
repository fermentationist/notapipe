<script lang="ts">
  interface Props {
    content: string;
  }

  let { content }: Props = $props();

  let html = $state("");
  let marked_loaded = false;
  let preview_el = $state<HTMLDivElement | null>(null);

  // GitHub-compatible heading slug: lowercase, keep alphanumeric+spaces+hyphens,
  // replace spaces with hyphens. Matches the format used in user-guide.md TOC.
  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  async function render(text: string): Promise<void> {
    if (!marked_loaded) {
      const { marked } = await import("marked");
      marked.setOptions({ breaks: true, gfm: true });
      marked.use({
        renderer: {
          heading({ text, depth }: { text: string; depth: number }): string {
            const id = slugify(text);
            return `<h${depth} id="${id}">${text}</h${depth}>\n`;
          },
          link({ href, text }: { href: string; text: string }): string {
            if (href.startsWith("#")) {
              return `<a href="${href}">${text}</a>`;
            }
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
          },
        },
      });
      marked_loaded = true;
    }
    const { marked } = await import("marked");
    html = await marked(text);
  }

  // Intercept anchor-link clicks to scroll within the container without
  // changing window.location.hash (which would overwrite the room token).
  function handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor === null) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (href === null || !href.startsWith("#")) {
      return;
    }
    event.preventDefault();
    const id = href.slice(1);
    const heading = preview_el?.querySelector(`[id="${id}"]`);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $effect(() => {
    render(content);
  });
</script>

<div
  class="preview"
  aria-label="Markdown preview"
  bind:this={preview_el}
  onclick={handleClick}
  role="document"
>
  {#if html}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html html}
  {:else}
    <p class="empty-hint">Nothing to preview yet — start typing in the editor.</p>
  {/if}
</div>

<style>
  .preview {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 1rem 1.25rem;
    box-sizing: border-box;
    color: var(--color-text);
    font-family: inherit;
    font-size: 1rem;
    line-height: var(--line-height);
  }

  .empty-hint {
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* ---- Prose styles ---- */
  .preview :global(h1),
  .preview :global(h2),
  .preview :global(h3),
  .preview :global(h4),
  .preview :global(h5),
  .preview :global(h6) {
    margin: 1.2em 0 0.4em;
    line-height: 1.3;
    color: var(--color-text);
  }

  .preview :global(h1) { font-size: 1.6rem; }
  .preview :global(h2) { font-size: 1.3rem; }
  .preview :global(h3) { font-size: 1.1rem; }

  .preview :global(p) {
    margin: 0.6em 0;
  }

  .preview :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
  }

  .preview :global(code) {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.88em;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 0.1em 0.35em;
  }

  .preview :global(pre) {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 0.75em 0;
  }

  .preview :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.9em;
  }

  .preview :global(blockquote) {
    border-left: 3px solid var(--color-accent);
    margin: 0.75em 0;
    padding: 0.1em 1em;
    color: var(--color-text-muted);
  }

  .preview :global(ul),
  .preview :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .preview :global(li) {
    margin: 0.25em 0;
  }

  .preview :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 1em 0;
  }

  .preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
    font-size: 0.9em;
  }

  .preview :global(th),
  .preview :global(td) {
    border: 1px solid var(--color-border);
    padding: 0.35em 0.65em;
    text-align: left;
  }

  .preview :global(th) {
    background: var(--color-surface);
  }

  .preview :global(img) {
    max-width: 100%;
  }
</style>
