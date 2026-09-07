<script lang="ts">
  import { page } from '$app/state';
  let { dense }: { dense: boolean } = $props();
  const back = $derived(page.url.pathname + page.url.search);
</script>

<form method="POST" action="/density" class="segment" role="group" aria-label="Tæthed">
  <input type="hidden" name="back" value={back} />
  <button type="submit" name="value" value="normal" aria-pressed={!dense}>Normal</button>
  <button type="submit" name="value" value="dense" aria-pressed={dense}>Kompakt</button>
</form>
