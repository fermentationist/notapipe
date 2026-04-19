<script lang="ts">
  interface Props { size?: number; stroke_width?: number; }
  let { size = 13, stroke_width = 1.6 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke_width}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M3 3l10 10M13 3L3 13"/>
</svg>
