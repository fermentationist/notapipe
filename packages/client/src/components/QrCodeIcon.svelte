<script lang="ts">
  interface Props { size?: number; }
  let { size = 14 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 14 14"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <rect x="1" y="1" width="4" height="4" rx="0.5" />
  <rect x="9" y="1" width="4" height="4" rx="0.5" />
  <rect x="1" y="9" width="4" height="4" rx="0.5" />
  <rect x="2.5" y="2.5" width="1" height="1" fill="currentColor" stroke="none" />
  <rect x="10.5" y="2.5" width="1" height="1" fill="currentColor" stroke="none" />
  <rect x="2.5" y="10.5" width="1" height="1" fill="currentColor" stroke="none" />
  <path d="M9 9h1.5v1.5" />
  <path d="M12 9v1.5H13" />
  <path d="M9 12h1.5v1" />
  <path d="M12 12.5h1" />
</svg>
