<script lang="ts">
  import { page } from '$app/state';
  import NavProgress from '$lib/components/NavProgress.svelte';
  let { data, children } = $props();

  const items = [
    { group: 'Salg' },
    { href: '/fakturaer', label: 'Fakturaer', count: () => data.counts.invoices },
    { href: '/kunder', label: 'Kunder', count: () => data.counts.customers },
    { group: 'Køb' },
    { href: '/udgifter', label: 'Udgifter', count: () => data.counts.expenses },
    { group: 'Rapporter' },
    { href: '/moms', label: 'Momsindberetning' },
    { href: '/resultat', label: 'Resultat' },
    { href: '/udgifter/rapport', label: 'Udgiftsrapport' },
    { href: '/cashflow', label: 'Cashflow' },
    { href: '/kontoudtog', label: 'Kontoudtog' },
    { href: '/balance', label: 'Balance' },
    { group: 'System' },
    { href: '/indstillinger', label: 'Indstillinger' },
    { href: '/eksport', label: 'Eksport' }
  ];

  // The longest matching href wins, so /udgifter/rapport lights Udgiftsrapport rather than Udgifter.
  function current(href: string): 'page' | undefined {
    const p = page.url.pathname;
    const best = items
      .filter((i): i is { href: string; label: string } => 'href' in i && (p === i.href || p.startsWith(i.href + '/')))
      .sort((a, b) => b.href.length - a.href.length)[0];
    return best?.href === href ? 'page' : undefined;
  }
</script>

<div class="app">
  <aside class="sidebar">
    <a class="brand" href="/">
      <img class="brand__mark" src="/logo.svg" width="26" height="26" alt="" />
      <span class="brand__name">Kvit<span class="brand__sub">{data.companyName || 'Bogholderi'}</span></span>
    </a>

    <nav class="nav" aria-label="Hovedmenu">
      <a class="nav__item" href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>Overblik</a>
      {#each items as item}
        {#if 'group' in item}
          <span class="nav__group">{item.group}</span>
        {:else}
          <a class="nav__item" href={item.href} aria-current={current(item.href)}>
            {item.label}
            {#if item.count}<span class="nav__count">{item.count()}</span>{/if}
          </a>
        {/if}
      {/each}
    </nav>

    <!-- The rail's footer pins the current VAT deadline: this app exists because of that date. -->
    <div class="sidebar__foot"><p>Moms {data.vatDeadline.quarter}. kvt. · frist {data.vatDeadline.date}</p></div>
  </aside>

  <div class="main">
    <header class="topbar">
      <span class="topbar__ctx topbar__ctx--now">{data.context}</span>
      <span class="topbar__right">
        <span class="topbar__ctx">Frist for moms: {data.vatDeadline.date}</span>
        <form method="POST" action="/logout">
          <button type="submit" class="btn btn--sm">Log ud</button>
        </form>
      </span>
    </header>

    <div class="content">
      <NavProgress />
      {@render children()}
    </div>
  </div>
</div>

<style>
  .topbar__right { display: flex; align-items: center; gap: var(--space-4); }
</style>
