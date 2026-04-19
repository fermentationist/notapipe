<script lang="ts">
  import * as Y from "yjs";
  import { applyTextareaDiff, adjustCursor } from "../yjs/provider.ts";

  interface Props {
    doc: Y.Doc;
    ytext: Y.Text;
    readonly?: boolean;
    code_mode?: boolean;
    language?: string;
  }

  let {
    doc,
    ytext,
    readonly = false,
    code_mode = false,
    language = "javascript",
  }: Props = $props();

  async function importLanguage(lang: string): Promise<void> {
    switch (lang) {
      case "javascript":
        await import("prism-code-editor/prism/languages/javascript");
        break;
      case "typescript":
        await import("prism-code-editor/prism/languages/typescript");
        break;
      case "jsx":
        await import("prism-code-editor/prism/languages/jsx");
        break;
      case "tsx":
        await import("prism-code-editor/prism/languages/tsx");
        break;
      case "html":
        await import("prism-code-editor/languages/html");
        break;
      case "css":
        await import("prism-code-editor/languages/css");
        break;
      case "json":
        await import("prism-code-editor/languages/json");
        break;
      case "python":
        await import("prism-code-editor/languages/python");
        break;
      case "bash":
        await import("prism-code-editor/languages/bash");
        break;
      case "sql":
        await import("prism-code-editor/languages/sql");
        break;
      case "yaml":
        await import("prism-code-editor/languages/yaml");
        break;
      case "rust":
        await import("prism-code-editor/languages/rust");
        break;
      case "php":
        await import("prism-code-editor/languages/php");
        break;
      case "ruby":
        await import("prism-code-editor/languages/ruby");
        break;
      default:
        break; // plain text — no grammar needed
    }
  }

  // --- Standard textarea state ---
  let textarea_element: HTMLTextAreaElement;
  let local_value = $state("");
  let is_applying_remote = false;

  // --- Code mode container ---
  let code_container: HTMLDivElement | undefined = $state();

  // Sync remote Yjs changes → textarea (standard mode only)
  $effect(() => {
    if (code_mode) return;
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

    if (event.key === "Enter") {
      event.preventDefault();
      const start = el.selectionStart;
      const line_start = local_value.lastIndexOf("\n", start - 1) + 1;
      const current_line = local_value.slice(line_start, start);
      const indent = current_line.match(/^(\s*)/)?.[1] ?? "";
      applyInsertion(el, "\n" + indent);
    }
  }

  // --- Prism code editor (code mode) ---
  $effect(() => {
    if (!code_mode || code_container === undefined) return;

    let cleanup_called = false;
    let pce_editor: {
      remove: () => void;
      on: (event: string, cb: (v: string) => void) => () => void;
      setOptions: (opts: Record<string, unknown>) => void;
    } | null = null;
    let ytext_unobserve: (() => void) | null = null;
    let theme_style: HTMLStyleElement | null = null;

    (async () => {
      const [
        { createEditor },
        { matchBrackets },
        { highlightBracketPairs },
        { defaultCommands },
      ] = await Promise.all([
        import("prism-code-editor"),
        import("prism-code-editor/match-brackets"),
        import("prism-code-editor/highlight-brackets"),
        import("prism-code-editor/commands"),
      ]);
      await import("prism-code-editor/layout.css");

      if (cleanup_called || code_container === undefined) return;

      // Load only the two themes actually used — bypasses the full theme barrel
      // so Vite doesn't bundle all 13 themes as lazy chunks.
      const is_dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const { default: theme_css } = is_dark
        ? await import("prism-code-editor/themes/github-dark.css?inline")
        : await import("prism-code-editor/themes/github-light.css?inline");

      if (cleanup_called || code_container === undefined) return;

      // Inject theme CSS scoped under a unique class
      theme_style = document.createElement("style");
      theme_style.textContent = theme_css ?? "";
      document.head.appendChild(theme_style);

      // Load grammar for the initial language
      await importLanguage(language);
      if (cleanup_called) return;

      // Create the editor
      const initial_value = ytext.toString();
      pce_editor = createEditor(
        code_container,
        {
          value: initial_value,
          language,
          lineNumbers: true,
          tabSize: 2,
          insertSpaces: false,
          readOnly: readonly,
        },
        matchBrackets(),
        highlightBracketPairs(),
        defaultCommands(),
      );

      // Editor → Yjs
      let old_value = initial_value;
      let is_local = false;

      const remove_update_listener = pce_editor.on(
        "update",
        (new_value: string) => {
          if (is_applying_remote) return;
          is_local = true;
          applyTextareaDiff(ytext, doc, old_value, new_value);
          old_value = new_value;
          is_local = false;
        },
      );

      // Yjs → Editor
      const ytext_observer = () => {
        if (is_local) return;
        is_applying_remote = true;
        const new_value = ytext.toString();
        pce_editor?.setOptions({ value: new_value });
        old_value = new_value;
        is_applying_remote = false;
      };
      ytext.observe(ytext_observer);

      ytext_unobserve = () => {
        ytext.unobserve(ytext_observer);
        remove_update_listener();
      };

      // Expose the editor so the language-change effect can reach it
      // (language is a reactive prop — track changes after initial setup)
      const editor_ref = pce_editor;
      const lang_unwatch = $effect.root(() => {
        $effect(() => {
          const lang = language; // reactive read
          importLanguage(lang).then(() => {
            editor_ref.setOptions({ language: lang });
          });
        });
        return () => {};
      });
      const original_unobserve = ytext_unobserve;
      ytext_unobserve = () => {
        original_unobserve();
        lang_unwatch();
      };

      if (cleanup_called) {
        ytext_unobserve();
        pce_editor.remove();
        theme_style?.remove();
      }
    })();

    return () => {
      cleanup_called = true;
      ytext_unobserve?.();
      pce_editor?.remove();
      theme_style?.remove();
    };
  });
</script>

{#if code_mode}
  <div
    class="code-editor-root"
    bind:this={code_container}
    aria-label="Code editor"
  ></div>
{:else}
  <div class="editor-root">
    <textarea
      bind:this={textarea_element}
      value={local_value}
      oninput={handleInput}
      onkeydown={handleKeydown}
      {readonly}
      spellcheck="false"
      autocorrect="off"
      autocapitalize="off"
      placeholder="Start typing here..."
      aria-label="Shared document"
    ></textarea>
  </div>
{/if}

<style>
  /* --- Standard editor --- */
  .editor-root {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
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
    font-family: var(--standard-font-family, "IBM Plex Mono", monospace);
    font-size: var(--standard-font-size, 1rem);
    line-height: var(--standard-line-height, 28px);
    padding: 1rem;
    box-sizing: border-box;
    caret-color: var(--color-accent);
  }

  textarea::placeholder {
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* Focus mode: lined notebook paper look */
  :global(.focus-mode) textarea {
    padding: 0.5rem 3rem 4rem 4rem;
    font-family: var(--focus-font-family, "IBM Plex Mono", monospace);
    font-size: var(--focus-font-size, 1.05rem);
    line-height: var(--focus-line-height, 28px);
    color: var(--color-focus-text);
    caret-color: var(--color-focus-text);
    background-image: repeating-linear-gradient(
      to bottom,
      transparent,
      transparent calc(var(--focus-line-height, 28px) - 1px),
      var(--color-focus-rule) calc(var(--focus-line-height, 28px) - 1px),
      var(--color-focus-rule) var(--focus-line-height, 28px)
    );
    background-attachment: local;
    padding-top: calc(var(--focus-line-height, 28px) * 2);
  }

  :global(.focus-mode) textarea::placeholder {
    font-style: italic;
    color: var(--color-focus-rule);
  }

  /* --- Prism code editor container --- */
  .code-editor-root {
    width: 100%;
    height: 100%;
    overflow: hidden;
    /* Map our code-mode tokens onto prism's CSS variables */
    --pce-bg: var(--code-bg, #1a1a18);
    --pce-cursor: var(--code-caret-color, #e05c4a);
    --pce-line-number: var(--code-gutter-text, #6b6660);
    --pce-selection: color-mix(
      in srgb,
      var(--color-accent, #e05c4a) 30%,
      transparent
    );
    --pce-bg-highlight: color-mix(
      in srgb,
      var(--color-text, #e8e3d8) 5%,
      transparent
    );
    /* Base text color — overridden per-token by the Prism theme */
    color: var(--code-text, #e8e3d8);
    font-family: var(--code-font-family, "IBM Plex Mono", monospace);
    font-size: var(--code-font-size, 0.9rem);
    line-height: var(--code-line-height, 22px);
  }

  /* Ensure the prism editor fills the container */
  .code-editor-root :global(.prism-code-editor) {
    height: 100%;
    width: 100%;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
  }
</style>
