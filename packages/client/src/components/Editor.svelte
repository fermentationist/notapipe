<script lang="ts">
  import * as Y from "yjs";
  import { applyTextareaDiff, adjustCursor } from "../yjs/provider.ts";

  interface Props {
    doc: Y.Doc;
    ytext: Y.Text;
    readonly?: boolean;
    code_mode?: boolean;
  }

  let { doc, ytext, readonly = false, code_mode = false }: Props = $props();

  let textarea_element: HTMLTextAreaElement;
  let line_numbers_el: HTMLDivElement | undefined = $state();
  let local_value = $state("");
  let is_applying_remote = false;

  const line_count = $derived(local_value.split("\n").length);
  const line_numbers_text = $derived(
    Array.from({ length: line_count }, (_, i) => i + 1).join("\n"),
  );

  // Sync remote Yjs changes → textarea
  $effect(() => {
    const observer = () => {
      if (is_applying_remote) {
        return;
      }
      const new_value = ytext.toString();
      if (new_value !== local_value) {
        const old_value = local_value;
        const cursor_start = textarea_element?.selectionStart ?? 0;
        const cursor_end = textarea_element?.selectionEnd ?? 0;
        local_value = new_value;

        // Adjust cursor for remote edits rather than blindly restoring the old position.
        // Without this, a remote insert before the cursor pulls it backward.
        const new_start = adjustCursor(old_value, new_value, cursor_start);
        const new_end = adjustCursor(old_value, new_value, cursor_end);

        requestAnimationFrame(() => {
          if (textarea_element) {
            textarea_element.selectionStart = new_start;
            textarea_element.selectionEnd = new_end;
          }
        });
      }
    };

    ytext.observe(observer);
    // Sync initial state
    local_value = ytext.toString();

    return () => {
      ytext.unobserve(observer);
    };
  });

  function applyInsertion(el: HTMLTextAreaElement, text: string): void {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const old_value = local_value;
    const new_value = old_value.slice(0, start) + text + old_value.slice(end);
    local_value = new_value;
    is_applying_remote = true;
    applyTextareaDiff(ytext, doc, old_value, new_value);
    is_applying_remote = false;
    const new_cursor = start + text.length;
    requestAnimationFrame(() => {
      el.selectionStart = new_cursor;
      el.selectionEnd = new_cursor;
    });
  }

  function handleInput(event: Event): void {
    const new_value = (event.target as HTMLTextAreaElement).value;
    const old_value = local_value;
    local_value = new_value;

    is_applying_remote = true;
    applyTextareaDiff(ytext, doc, old_value, new_value);
    is_applying_remote = false;
  }

  function handleKeydown(event: KeyboardEvent): void {
    const el = event.target as HTMLTextAreaElement;

    if (event.key === "Tab") {
      event.preventDefault();
      applyInsertion(el, "\t");
      return;
    }

    if (event.key === "Enter" && code_mode) {
      event.preventDefault();
      const start = el.selectionStart;
      // Find start of current line
      const line_start = local_value.lastIndexOf("\n", start - 1) + 1;
      const current_line = local_value.slice(line_start, start);
      const indent = current_line.match(/^(\s*)/)?.[1] ?? "";
      applyInsertion(el, "\n" + indent);
    }
  }

  function handleScroll(event: Event): void {
    if (line_numbers_el !== undefined) {
      line_numbers_el.scrollTop = (event.target as HTMLTextAreaElement).scrollTop;
    }
  }
</script>

<div class="editor-root" class:has-line-numbers={code_mode}>
  {#if code_mode}
    <div class="line-numbers" bind:this={line_numbers_el} aria-hidden="true">{line_numbers_text}</div>
  {/if}
  <textarea
    bind:this={textarea_element}
    value={local_value}
    oninput={handleInput}
    onkeydown={handleKeydown}
    onscroll={code_mode ? handleScroll : undefined}
    {readonly}
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
    placeholder={code_mode ? "" : "Start typing…"}
    aria-label="Shared document"
  ></textarea>
</div>

<style>
  .editor-root {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .line-numbers {
    width: 3.25rem;
    flex-shrink: 0;
    overflow: hidden;
    text-align: right;
    padding: 1rem 0.6rem 1rem 0;
    color: var(--color-text-muted);
    font-family: var(--editor-font-family, "IBM Plex Mono", monospace);
    font-size: 1rem;
    line-height: var(--line-height);
    border-right: 1px solid var(--color-border);
    user-select: none;
    box-sizing: border-box;
    white-space: pre;
    opacity: 0.45;
  }

  textarea {
    flex: 1;
    min-width: 0;
    height: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--editor-font-family, "IBM Plex Mono", monospace);
    font-size: 1rem;
    line-height: var(--line-height);
    padding: 1rem;
    box-sizing: border-box;
    caret-color: var(--color-accent);
  }

  textarea::placeholder {
    color: var(--color-text-muted);
  }

  .has-line-numbers textarea {
    padding-left: 0.75rem;
  }

  /* Focus mode: lined notebook paper look */
  :global(.focus-mode) textarea {
    padding: 0.5rem 3rem 4rem 4rem; /* generous left margin like a notebook */
    font-size: 1.05rem;
    color: var(--color-focus-text);
    caret-color: var(--color-focus-text);
    /* Ruled lines aligned to line-height grid */
    background-image: repeating-linear-gradient(
      to bottom,
      transparent, transparent calc(var(--line-height) - 1px),
      var(--color-focus-rule) calc(var(--line-height) - 1px),
      var(--color-focus-rule) var(--line-height)
    );
    background-attachment: local;
    /* Push first line down to align with the first rule */
    padding-top: calc(var(--line-height) * 2);
  }

  :global(.focus-mode) textarea::placeholder {
    font-style: italic;
    color: var(--color-focus-rule);
  }
</style>
