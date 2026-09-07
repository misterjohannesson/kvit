<script lang="ts">
  import { page } from '$app/state';
</script>

<div class="errorpage">
  <div class="panel errorpage__panel">
    <div class="panel__body">
      <p class="pagehead__eyebrow mono">{page.status}</p>
      <h1>{page.status === 404 ? 'Siden findes ikke' : page.error?.message ?? 'Der opstod en fejl'}</h1>
      <p><a href="/">Til overblik</a></p>
    </div>
  </div>
</div>

<style>
  .errorpage { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--space-8); }
  .errorpage__panel { width: 100%; max-width: var(--layout-prose-max); }
  h1 { margin: 0 0 var(--space-4); font-size: var(--text-xl); font-weight: var(--weight-semibold); color: var(--text-primary); }
  p { margin: 0; }
</style>
