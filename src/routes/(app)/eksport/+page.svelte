<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Eksport · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">System</p>
    <h1>Eksport</h1>
  </div>
  <div class="pagehead__actions">
    <a class="btn" href="/api/export">Eksportér alt (zip)</a>
  </div>
</div>

<div class="layout-8-4">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Indhold af eksporten</h3>
    </div>
    <div class="panel__body">
      <p class="prose">
        Én zip-fil med alt, revisor eller Skattestyrelsen kan bede om. CSV-filerne er UTF-8, semikolonseparerede
        og bruger dansk decimalkomma. Alle bilag og fakturaer ligger med som de gemte filer.
      </p>
      <div class="table-wrap">
        <table class="data data--dense">
          <thead>
            <tr><th scope="col">Fil</th><th scope="col">Indhold</th><th scope="col" class="num">Rækker</th></tr>
          </thead>
          <tbody>
            <tr><td class="mono">invoices.csv</td><td>Fakturaer og kreditnotaer med nummer, status, beløb og PDF-sti</td><td class="num">{data.counts.invoices}</td></tr>
            <tr><td class="mono">invoice_lines.csv</td><td>Fakturalinjer</td><td class="num">{data.counts.lines}</td></tr>
            <tr><td class="mono">expenses.csv</td><td>Udgifter med bilagsnummer, moms og filsti</td><td class="num">{data.counts.expenses}</td></tr>
            <tr><td class="mono">audit_log.csv</td><td>Revisionsspor: alle oprettelser, udstedelser, krediteringer, ændringer og uploads</td><td class="num">{data.counts.audit}</td></tr>
            <tr><td class="mono">files/</td><td>Alle faktura-PDF'er og udgiftsbilag</td><td class="num">{data.counts.files}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Opbevaring</h3>
    </div>
    <div class="panel__body">
      <p class="hint prose">Bogføringsloven kræver fem års opbevaring og sikkerhedskopi hos tredjepart. Gem eksporten et andet sted end på serveren – se README for backup med cron.</p>
    </div>
  </div>
</div>

<style>
  .prose { margin: 0 0 var(--space-4); max-width: var(--layout-prose-max); }
  .panel__body .hint.prose { margin: 0; }
</style>
