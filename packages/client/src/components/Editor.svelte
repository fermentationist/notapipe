<script lang="ts">
  import * as Y from "yjs";
  import { applyTextareaDiff, adjustCursor } from "../yjs/provider.ts";

  interface Props {
    doc: Y.Doc;
    ytext: Y.Text;
    readonly?: boolean;
  }

  let { doc, ytext, readonly = false }: Props = $props();

  let textarea_element: HTMLTextAreaElement;
  let local_value = $state("");
  let is_applying_remote = false;

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

  function handleInput(event: Event): void {
    const new_value = (event.target as HTMLTextAreaElement).value;
    const old_value = local_value;
    local_value = new_value;

    is_applying_remote = true;
    applyTextareaDiff(ytext, doc, old_value, new_value);
    is_applying_remote = false;
  }


</script>

<textarea
  bind:this={textarea_element}
  value={local_value}
  oninput={handleInput}
  {readonly}
  spellcheck="false"
  autocorrect="off"
  autocapitalize="off"
  placeholder="Start typing…"
  aria-label="Shared document"
></textarea>

<style>
  textarea {
    width: 100%;
    height: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font-family: "IBM Plex Mono", monospace;
    font-size: 1rem;
    line-height: var(--line-height);
    padding: 1rem;
    box-sizing: border-box;
    caret-color: var(--color-accent);
  }

  textarea::placeholder {
    color: var(--color-text-muted);
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
