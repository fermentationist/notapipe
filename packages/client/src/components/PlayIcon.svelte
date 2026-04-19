<script lang="ts">
  interface Props { size?: number; }
  let { size = 12 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="currentColor"
  aria-hidden="true"
>
  <path d="M3 2.5l10 5.5-10 5.5V2.5z"/>
</svg>
