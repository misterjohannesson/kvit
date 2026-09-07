<script lang="ts">
  import { page } from '$app/state';
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
    { href: '/cashflow', label: 'Cashflow' },
    { href: '/balance', label: 'Balance' },
    { group: 'System' },
    { href: '/indstillinger', label: 'Indstillinger' },
    { href: '/eksport', label: 'Eksport' }
  ];

  function current(href: string): 'page' | undefined {
    const p = page.url.pathname;
    return p === href || p.startsWith(href + '/') ? 'page' : undefined;
  }
</script>

<div class="app">
  <aside class="sidebar">
    <a class="brand" href="/">
      <span class="brand__mark"></span>
      <span class="brand__name">{data.companyName || 'Faktura'}</span>
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
  </aside>

  <div class="main">
    <header class="topbar">
      <span class="topbar__ctx">{data.context}</span>
      <form method="POST" action="/logout">
        <button type="submit" class="btn btn--sm">Log ud</button>
      </form>
    </header>

    <div class="content">
      {@render children()}
    </div>
  </div>
</div>
