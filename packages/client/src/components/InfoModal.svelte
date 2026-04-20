<script lang="ts">
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import { USER_GUIDE_CONTENT, QR_MODE_CONTENT } from "$lib/constants/docs.ts";

  // Map the relative paths used in the README/docs to their bundled content
  const DOC_MAP: Record<string, { title: string; content: string }> = {
    "docs/user-guide.md": { title: "User Guide", content: USER_GUIDE_CONTENT },
    "docs/qr-mode.md":    { title: "QR Mode Deep-Dive", content: QR_MODE_CONTENT },
  };

  interface Props {
    title: string;
    content: string | null; // null = loading
    onclose: () => void;
  }

  let { title, content, onclose }: Props = $props();

  type DocEntry = { title: string; content: string | null };

  let nav_stack = $state<DocEntry[]>([{ title, content }]);
  const current = $derived(nav_stack[nav_stack.length - 1]!);
  const can_go_back = $derived(nav_stack.length > 1);

  let modal_body_el: HTMLDivElement | undefined = $state();

  function navigate(href: string): void {
    const doc = DOC_MAP[href];
    if (!doc) { return; }
    nav_stack = [...nav_stack, doc];
    modal_body_el?.scrollTo({ top: 0 });
  }

  function goBack(): void {
    nav_stack = nav_stack.slice(0, -1);
    modal_body_el?.scrollTo({ top: 0 });
  }

  function handleBodyClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) { return; }
    const href = anchor.getAttribute("href") ?? "";
    if (DOC_MAP[href]) {
      event.preventDefault();
      navigate(href);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (can_go_back) { goBack(); } else { onclose(); }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { onclose(); } }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={current.title}>
    <div class="modal-header">
      {#if can_go_back}
        <button class="back-btn" onclick={goBack} aria-label="Back">← Back</button>
      {/if}
      <h2>{current.title}</h2>
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    </div>
    <div class="modal-body" bind:this={modal_body_el} onclick={handleBodyClick} role="presentation">
      {#if current.content === null}
        <p class="loading">Loading…</p>
      {:else}
        <MarkdownPreview content={current.content} />
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }

  .modal {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    width: min(96vw, 760px);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    gap: 0.75rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    flex: 1;
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--color-accent);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.82rem;
    padding: 0.2rem 0;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .back-btn:hover {
    opacity: 0.75;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem 0.5rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .loading {
    padding: 2rem;
    color: var(--color-text-muted);
    font-style: italic;
    margin: 0;
  }
</style>
