<script lang="ts">
  // Self-hosted fonts (spec: no CDN assets). Archivo carries the UI, IBM Plex Mono every number, date and ID.
  import '@fontsource/archivo/400.css';
  import '@fontsource/archivo/500.css';
  import '@fontsource/archivo/600.css';
  import '@fontsource/ibm-plex-mono/400.css';
  import '@fontsource/ibm-plex-mono/500.css';
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
