<script lang="ts">
  let { data, form } = $props();
  const staged = $derived(form?.staged ?? data.staged);
  const labels: Record<string, string> = {
    accounts: 'Konti',
    customers: 'Kunder',
    suppliers: 'Leverandører',
    invoices: 'Fakturaer og kreditnotaer',
    lines: 'Fakturalinjer',
    attachments: 'Vedhæftninger',
    expenses: 'Udgifter',
    movements: 'Bankbevægelser',
    audit: 'Revisionsspor'
  };
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
</script>

<svelte:head><title>Eksport · Kvit</title></svelte:head>

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
        og bruger dansk decimalkomma. Alle bilag og fakturaer ligger med som de gemte filer. Den samme zip kan
        indlæses igen nedenfor, så revisors rettelser eller en gammel eksport kan blive til appens data.
      </p>
      <div class="table-wrap">
        <table class="data data--dense">
          <thead>
            <tr><th scope="col">Fil</th><th scope="col">Indhold</th><th scope="col" class="num">Rækker</th></tr>
          </thead>
          <tbody>
            <tr><td class="mono">invoices.csv</td><td class="wrap">Fakturaer og kreditnotaer med nummer, status, beløb og PDF-sti</td><td class="num">{data.counts.invoices}</td></tr>
            <tr><td class="mono">invoice_lines.csv</td><td class="wrap">Fakturalinjer</td><td class="num">{data.counts.lines}</td></tr>
            <tr><td class="mono">invoice_attachments.csv</td><td class="wrap">PDF'er vedhæftet fakturaer ved udstedelse</td><td class="num">{data.counts.attachments}</td></tr>
            <tr><td class="mono">customers.csv</td><td class="wrap">Kunder med adresse, CVR og betalingsfrist</td><td class="num">{data.counts.customers}</td></tr>
            <tr><td class="mono">suppliers.csv</td><td class="wrap">Leverandører (id og navn); udgifterne peger på dem</td><td class="num">{data.counts.suppliers}</td></tr>
            <tr><td class="mono">expenses.csv</td><td class="wrap">Udgifter med bilagsnummer, moms og filsti</td><td class="num">{data.counts.expenses}</td></tr>
            <tr><td class="mono">cash_movements.csv</td><td class="wrap">Bankbevægelser uden for fakturaer og udgifter (moms, ejer, skat, korrektioner)</td><td class="num">{data.counts.movements}</td></tr>
            <tr><td class="mono">accounts.csv</td><td class="wrap">Kontoplan med grupper og status</td><td class="num">{data.counts.accounts}</td></tr>
            <tr><td class="mono">settings.csv</td><td class="wrap">Firmaoplysninger, nummerserie, åbningssaldo og balancekonti</td><td class="num"></td></tr>
            <tr><td class="mono">audit_log.csv</td><td class="wrap">Revisionsspor: alle oprettelser, udstedelser, krediteringer, ændringer og uploads</td><td class="num">{data.counts.audit}</td></tr>
            <tr><td class="mono">posteringer.csv</td><td class="wrap">Afledt kassekladde: hver faktura, betaling, udgift og bankbevægelse som debet/kredit på kontoplanen og balancekontiene fra Indstillinger. Beregnes ved eksport og læses ikke ind igen.</td><td class="num"></td></tr>
            <tr><td class="mono">files/</td><td class="wrap">Alle faktura-PDF'er og udgiftsbilag</td><td class="num">{data.counts.files}</td></tr>
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

<section>
  <div class="section__head">
    <h2>Gendan fra eksport</h2>
    <p>
      Indlæs en eksport-zip og erstat alle appens data med den: revisors rettelser i CSV-filerne, eller en ældre
      eksport som sikkerhedskopi. Filen kontrolleres først (beløb skal passe til linjerne, numre må ikke gentages,
      konti og kunder skal findes), og intet ændres, før du har set opsummeringen og bekræftet. De nuværende data
      kopieres til <span class="mono">backups/data.bakNN/</span> i datamappen, inden noget erstattes.
    </p>
  </div>

  {#if form?.error}<p class="error">{form.error}</p>{/if}

  {#if form?.restored}
    <div class="panel">
      <div class="panel__body">
        <p class="hint">
          Data gendannet fra eksporten. De tidligere data ligger i <span class="mono">{form.restored.backupDir}</span>
          (databasen som <span class="mono">app.db</span>, bilagene under <span class="mono">files/</span>, den indlæste zip som <span class="mono">import.zip</span>).
          Kontoplanen har nu <span class="mono">{form.restored.counts.accounts}</span> konti, <span class="mono">{form.restored.counts.invoices}</span> fakturaer,
          <span class="mono">{form.restored.counts.expenses}</span> udgifter og <span class="mono">{form.restored.files}</span> filer.
        </p>
        {#if form.restored.warnings.length}
          <ul class="hint">{#each form.restored.warnings as w (w)}<li>{w}</li>{/each}</ul>
        {/if}
      </div>
    </div>
  {:else if staged}
    <div class="panel">
      <div class="panel__head">
        <h3 class="panel__title">Opsummering af {staged.fileName}</h3>
        <span class="panel__meta">{mb(staged.sizeBytes)}{staged.companyName ? ` · ${staged.companyName}` : ''}</span>
      </div>
      <div class="table-wrap">
        <table class="data data--dense">
          <thead>
            <tr><th scope="col">Indhold</th><th scope="col" class="num">I zippen</th><th scope="col" class="num">Nu i appen</th></tr>
          </thead>
          <tbody>
            {#each Object.entries(staged.counts) as [key, c] (key)}
              <tr class={c.file !== c.current ? 'diff' : ''}>
                <td>{labels[key] ?? key}</td>
                <td class="num">{c.file}</td>
                <td class="num">{c.current}</td>
              </tr>
            {/each}
            <tr class={staged.files.inZip !== staged.files.current ? 'diff' : ''}>
              <td>Filer (PDF'er og bilag)</td>
              <td class="num">{staged.files.inZip}</td>
              <td class="num">{staged.files.current}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="panel__body">
        {#if staged.invoiceRange.first !== null}
          <p class="hint">Fakturanumre i zippen: <span class="mono">{staged.invoiceRange.first}</span> – <span class="mono">{staged.invoiceRange.last}</span>.</p>
        {/if}
        {#if staged.files.missing.length}
          <p class="error">{staged.files.missing.length} filer nævnes i CSV'erne men ligger ikke i zippen (fx <span class="mono">{staged.files.missing[0]}</span>). De poster får en manglende fil efter gendannelsen.</p>
        {/if}
        {#if staged.warnings.length}
          <ul class="hint">{#each staged.warnings as w (w)}<li>{w}</li>{/each}</ul>
        {/if}
        <div class="confirmbox" role="alertdialog" aria-labelledby="restore-title">
          <p class="confirmbox__title" id="restore-title">Erstat alle data med indholdet af zippen?</p>
          <p class="hint">
            Alle fakturaer, udgifter, bankbevægelser, kunder, kontoplan, indstillinger, revisionsspor og filer erstattes.
            De nuværende data kopieres først til <span class="mono">{staged.backupDir}</span>. Handlingen kan ikke fortrydes i appen; man kan
            kun gendanne igen fra kopien.
          </p>
          <form method="POST" action="?/apply" class="confirmform">
            <input type="hidden" name="id" value={staged.id} />
            <label class="check"><input type="checkbox" name="confirm" required /> Jeg har forstået, at alle nuværende data erstattes</label>
            <div class="confirmbox__actions">
              <button type="submit" formaction="?/discard" formnovalidate class="btn">Fortryd</button>
              <button type="submit" class="btn btn--primary btn--danger">Ja, erstat alle data</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  {:else}
    <form class="panel" method="POST" action="?/stage" enctype="multipart/form-data">
      <div class="panel__body">
        <div class="form-grid">
          <div class="field field--span-6">
            <label class="label" for="restore-file">Eksport-zip</label>
            <input class="input input--md input--file" id="restore-file" name="file" type="file" accept=".zip,application/zip" required />
            <span class="hint">Samme filnavne som eksporten ovenfor. <span class="mono">posteringer.csv</span> ignoreres; mangler <span class="mono">settings.csv</span>, beholdes de nuværende indstillinger.</span>
          </div>
        </div>
      </div>
      <div class="panel__foot">
        <button type="submit" class="btn">Kontrollér zippen</button>
      </div>
    </form>
  {/if}
</section>

<style>
  .prose { margin: 0 0 var(--space-4); max-width: var(--layout-prose-max); }
  .panel__body .hint.prose { margin: 0; }
  tr.diff td { font-weight: 600; }
  .confirmform { margin-top: var(--space-3); }
  .btn--danger.btn--primary { background: var(--status-overdue-ink); border-color: var(--status-overdue-ink); color: #fff; }
</style>
