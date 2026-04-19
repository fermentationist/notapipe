<script lang="ts">
  interface Props { size?: number; }
  let { size = 14 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M8 2v8M5 7l3 3 3-3M2 13h12"/>
</svg>
