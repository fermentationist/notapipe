<script lang="ts">
  interface Props { size?: number; }
  let { size = 15 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 15"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M14 1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3l3 3 3-3h3a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1z" />
</svg>
