<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Log ind · Faktura</title></svelte:head>

<div class="login">
  <form class="panel login__panel" method="POST">
    <div class="panel__head">
      <div class="brand">
        <span class="brand__mark"></span>
        <span class="brand__name">Faktura</span>
      </div>
    </div>
    <div class="panel__body">
      <div class="field {form?.error ? 'field--error' : ''}">
        <label class="label" for="password">Kodeord</label>
        <input class="input" id="password" name="password" type="password" autocomplete="current-password" required />
        {#if form?.error}
          <span class="error">{form.error}</span>
        {:else}
          <span class="hint">Fælles kodeord for bogholderiet.</span>
        {/if}
      </div>
    </div>
    <div class="panel__foot">
      <button type="submit" class="btn btn--primary">Log ind</button>
    </div>
  </form>
</div>

<style>
  .login {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8);
  }
  .login__panel {
    width: 100%;
    max-width: var(--field-max-width);
  }
</style>
