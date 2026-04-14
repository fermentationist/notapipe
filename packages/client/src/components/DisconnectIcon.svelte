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
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M6 10L10 6" />
  <path d="M4.5 12.5 A4.5 4.5 0 0 1 4.5 5.5 L6 7" />
  <path d="M11.5 3.5 A4.5 4.5 0 0 1 11.5 10.5 L10 9" />
</svg>
