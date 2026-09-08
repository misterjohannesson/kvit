<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Log ind · Kvit</title></svelte:head>

<div class="login">
  <form class="panel login__panel" method="POST">
    <div class="panel__head">
      <div class="brand brand--onlight">
        <img class="brand__mark" src="/logo.svg" width="26" height="26" alt="" />
        <span class="brand__name">Kvit<span class="brand__sub">Bogholderi</span></span>
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
      <button type="submit" class="btn btn--primary btn--std">Log ind</button>
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
  /* the lockup sits on the light panel head here, not on the navy rail */
  .brand--onlight { padding: 0; }
  .brand--onlight .brand__name { color: var(--text-primary); }
  .brand--onlight .brand__sub { color: var(--text-secondary); }
</style>
