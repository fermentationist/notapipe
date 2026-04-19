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
  <rect x="3" y="2" width="3.5" height="12" rx="1"/>
  <rect x="9.5" y="2" width="3.5" height="12" rx="1"/>
</svg>
