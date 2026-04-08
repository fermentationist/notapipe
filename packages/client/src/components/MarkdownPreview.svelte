<script lang="ts">
  interface Props {
    content: string;
  }

  let { content }: Props = $props();

  let html = $state("");
  let marked_loaded = false;

  async function render(text: string): Promise<void> {
    if (!marked_loaded) {
      const { marked } = await import("marked");
      // Configure once
      marked.setOptions({ breaks: true, gfm: true });
      marked_loaded = true;
    }
    const { marked } = await import("marked");
    html = await marked(text);
  }

  $effect(() => {
    render(content);
  });
</script>

<div class="preview" aria-label="Markdown preview">
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
