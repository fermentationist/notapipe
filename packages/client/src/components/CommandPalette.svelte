<script lang="ts">
  import { tick } from "svelte";

  export interface PaletteCommand {
    id: string;
    label: string;
    group: string;
    keywords?: string[];
    disabled?: boolean;
    action: () => void;
  }

  interface Props {
    commands: PaletteCommand[];
    onclose: () => void;
  }

  let { commands, onclose }: Props = $props();

  let query = $state("");
  let active_index = $state(0);
  let input_el: HTMLInputElement = $state() as HTMLInputElement;
  let list_el: HTMLDivElement = $state() as HTMLDivElement;

  function matches(cmd: PaletteCommand, q: string): boolean {
    if (q === "") { return true; }
    const search = q.toLowerCase();
    if (cmd.label.toLowerCase().includes(search)) { return true; }
    if (cmd.group.toLowerCase().includes(search)) { return true; }
    if (cmd.keywords?.some((k) => k.toLowerCase().includes(search))) { return true; }
    return false;
  }

  const filtered = $derived(commands.filter((cmd) => matches(cmd, query)));

  // Unique groups in the order they first appear
  const groups = $derived(
    filtered.reduce<string[]>((acc, cmd) => {
      if (!acc.includes(cmd.group)) { acc.push(cmd.group); }
      return acc;
    }, []),
  );

  // Flat list of selectable (non-disabled) commands — drives keyboard nav index
  const selectable = $derived(filtered.filter((cmd) => !cmd.disabled));

  // Map command id → index in selectable for O(1) active-state lookup
  const selectable_indices = $derived(new Map(selectable.map((cmd, i) => [cmd.id, i])));

  // Reset active index whenever the filtered set changes
  $effect(() => {
    const _ = filtered.length;
    active_index = 0;
  });

  function runCommand(cmd: PaletteCommand): void {
    if (cmd.disabled) { return; }
    onclose();
    cmd.action();
  }

  function scrollActiveIntoView(): void {
    tick().then(() => {
      list_el?.querySelector<HTMLElement>(".palette-item.active")?.scrollIntoView({ block: "nearest" });
    });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active_index = Math.min(active_index + 1, selectable.length - 1);
      scrollActiveIntoView();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      active_index = Math.max(active_index - 1, 0);
      scrollActiveIntoView();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const cmd = selectable[active_index];
      if (cmd !== undefined) { runCommand(cmd); }
    }
  }

  $effect(() => {
    tick().then(() => input_el?.focus());
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { onclose(); } }}
>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="search-row">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        bind:this={input_el}
        class="search-input"
        type="text"
        placeholder="Search commands…"
        bind:value={query}
        autocomplete="off"
        spellcheck="false"
        aria-label="Search commands"
        aria-autocomplete="list"
      />
      <kbd class="esc-hint">esc</kbd>
    </div>

    <div class="results" bind:this={list_el} role="listbox">
      {#if filtered.length === 0}
        <p class="empty">No commands match "{query}"</p>
      {:else}
        {#each groups as group (group)}
          <div class="group">
            <span class="group-label">{group}</span>
            {#each filtered.filter((c) => c.group === group) as cmd (cmd.id)}
              {@const sel_index = selectable_indices.get(cmd.id)}
              <button
                class="palette-item"
                class:active={sel_index === active_index}
                class:disabled={cmd.disabled}
                role="option"
                aria-selected={sel_index === active_index}
                aria-disabled={cmd.disabled}
                onclick={() => runCommand(cmd)}
                onmouseenter={() => {
                  if (sel_index !== undefined) { active_index = sel_index; }
                }}
              >
                {cmd.label}
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <div class="footer">
      <span>↑↓ navigate</span>
      <span>↵ run</span>
      <span>esc close</span>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    z-index: 200;
  }

  .palette {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    width: min(92vw, 520px);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.9rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .search-icon {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.9rem;
    outline: none;
    padding: 0;
    min-width: 0;
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .esc-hint {
    font-family: inherit;
    font-size: 0.65rem;
    color: var(--color-text-muted);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .results {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding: 0.35rem 0;
  }

  .empty {
    margin: 0;
    padding: 1.25rem 1rem;
    font-size: 0.82rem;
    color: var(--color-text-muted);
    text-align: center;
  }

  .group {
    padding: 0 0 0.25rem;
  }

  .group-label {
    display: block;
    padding: 0.4rem 1rem 0.2rem;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    opacity: 0.7;
  }

  .palette-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    text-align: left;
    padding: 0.45rem 1rem;
    font-family: inherit;
    font-size: 0.85rem;
    color: var(--color-text);
    cursor: pointer;
    border-radius: 0;
  }

  .palette-item.active {
    background: var(--color-bg);
    color: var(--color-accent);
  }

  .palette-item.disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .footer {
    display: flex;
    gap: 1rem;
    padding: 0.3rem 1rem;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .footer span {
    font-size: 0.62rem;
    color: var(--color-text-muted);
    opacity: 0.7;
  }
</style>
