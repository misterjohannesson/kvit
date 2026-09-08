<script lang="ts">
  import { navigating } from '$app/state';

  /**
   * Shown while a client-side navigation is in flight, after a short grace
   * period so quick pages never flash: a thin bar along the top and a
   * see-through veil over the content (style.md §3, "Loading").
   */
  let visible = $state(false);
  $effect(() => {
    if (!navigating.to) {
      visible = false;
      return;
    }
    const t = setTimeout(() => (visible = true), 150);
    return () => clearTimeout(t);
  });
</script>

{#if visible}
  <div class="loading" role="status" aria-live="polite" aria-label="Indlæser">
    <div class="loading__bar"></div>
  </div>
{/if}
