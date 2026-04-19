<script lang="ts">
  interface Props { size?: number; }
  let { size = 14 }: Props = $props();
</script>

<!-- Monitor-with-download-arrow, matching the Chrome "install app" icon style.
     Distinguishes "install to device" from a plain "download file" arrow. -->
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
  <!-- Monitor/screen frame -->
  <rect x="1.5" y="0.5" width="13" height="10" rx="1.5"/>
  <!-- Stand base (wider than monitor) -->
  <path d="M2.5 12h11"/>
  <!-- Arrow stem -->
  <path d="M8 2.5v5"/>
  <!-- Arrowhead chevron -->
  <path d="M5.5 5.5L8 8.5l2.5-3"/>
  <!-- Tray line -->
  <path d="M5.5 9h5"/>
</svg>
