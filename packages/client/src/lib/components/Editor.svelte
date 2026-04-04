<script lang="ts">
  import * as Y from "yjs";
  import { applyTextareaDiff } from "../../yjs/provider.ts";
  import { focus_mode_store } from "../../stores/focus_mode.ts";

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
      const remote_value = ytext.toString();
      if (remote_value !== local_value) {
        const selection_start = textarea_element?.selectionStart ?? 0;
        const selection_end = textarea_element?.selectionEnd ?? 0;
        local_value = remote_value;

        // Restore cursor after DOM update
        requestAnimationFrame(() => {
          if (textarea_element) {
            textarea_element.selectionStart = selection_start;
            textarea_element.selectionEnd = selection_end;
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

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && $focus_mode_store) {
      focus_mode_store.disable();
    }
  }

  function handleDblClick(): void {
    focus_mode_store.enable();
  }
</script>

<textarea
  bind:this={textarea_element}
  value={local_value}
  oninput={handleInput}
  onkeydown={handleKeydown}
  ondblclick={handleDblClick}
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

  /* Focus mode: ruled lines + grain — activated by .focus-mode on :root */
  :global(.focus-mode) textarea {
    background-image: repeating-linear-gradient(
      to bottom,
      transparent, transparent calc(var(--line-height) - 1px),
      var(--color-rule) calc(var(--line-height) - 1px),
      var(--color-rule) var(--line-height)
    );
    background-attachment: local;
  }
</style>
