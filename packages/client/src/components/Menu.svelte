<script lang="ts">
  export type MenuItemConfig =
    | {
        type?: "item";
        label: string;
        action: () => void;
        danger?: boolean;
        disabled?: boolean;
        checked?: boolean;
        hidden?: boolean;
      }
    | { type: "divider" };

  interface Props {
    items: MenuItemConfig[];
    /** Fixed-position anchor {top, right} for overlay menus (info/share/actions).
     *  Omit for absolute-positioned menus rendered inside a relative wrapper. */
    anchor?: { top: number; right: number } | null;
    /** Opens below the trigger instead of above (default). */
    placement?: "above" | "below";
    min_width?: string;
  }

  let { items, anchor = null, placement = "above", min_width }: Props = $props();

  const fixed_style = $derived(
    anchor
      ? `top: ${anchor.top}px; right: ${anchor.right}px;${min_width ? ` min-width: ${min_width};` : ""}`
      : "",
  );
</script>

<div
  class="menu"
  class:menu--fixed={anchor !== null}
  class:menu--below={placement === "below"}
  role="menu"
  style={fixed_style}
>
  {#each items as item}
    {#if item.type === "divider"}
      <div class="menu-divider" role="separator"></div>
    {:else if item.hidden !== true}
      <button
        class="menu-item"
        class:menu-item--danger={item.danger}
        class:menu-item--disabled={item.disabled}
        role="menuitem"
        onclick={item.action}
      >
        {item.label}
        {#if item.checked}
          <span class="menu-check">✓</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 60;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    padding: 4px 0;
    display: flex;
    flex-direction: column;
    min-width: 100%;
  }

  .menu--below {
    top: calc(100% + 4px);
    bottom: auto;
  }

  .menu--fixed {
    position: fixed;
    bottom: auto;
    left: auto;
    min-width: 160px;
    z-index: 300;
    white-space: nowrap;
  }

  .menu-item {
    background: none;
    border: none;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.82rem;
    padding: 0.4rem 0.9rem;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .menu-item:hover {
    background: var(--color-bg);
  }

  .menu-divider {
    height: 1px;
    background: var(--color-border);
    margin: 0.25rem 0;
  }

  .menu-check {
    margin-left: auto;
    padding-left: 1rem;
    color: var(--color-accent);
  }

  .menu-item--disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .menu-item--disabled:hover {
    background: none;
  }

  .menu-item--danger {
    color: var(--color-accent);
  }
</style>
