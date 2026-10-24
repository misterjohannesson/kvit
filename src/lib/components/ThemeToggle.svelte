<script lang="ts">
  import { page } from '$app/state';
  import { THEME_LABELS, THEMES, type Theme } from '$lib/theme';
  let { theme }: { theme: Theme } = $props();
  const back = $derived(page.url.pathname + page.url.search);
</script>

<form method="POST" action="/theme" class="segment" role="group" aria-label="Tema">
  {#each THEMES as t}
    <button type="submit" name="value" value={t} aria-pressed={theme === t}>{THEME_LABELS[t]}</button>
  {/each}
  <!-- last so the first button keeps the segment's no-left-border rule -->
  <input type="hidden" name="back" value={back} />
</form>
