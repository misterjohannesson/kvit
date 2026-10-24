<script lang="ts">
  /** The general how-to for the draft page, folded away; it remembers per browser whether it was left open. */
  const KEY = 'kvit.invoiceGuide.open';
  let open = $state(false);

  $effect(() => {
    try {
      open = localStorage.getItem(KEY) === '1';
    } catch {
      /* no storage: stays closed */
    }
  });

  function toggled(e: Event) {
    open = (e.currentTarget as HTMLDetailsElement).open;
    try {
      localStorage.setItem(KEY, open ? '1' : '0');
    } catch {
      /* no storage */
    }
  }
</script>

<details class="guide" {open} ontoggle={toggled}>
  <summary>
    <span class="guide__icon" aria-hidden="true">i</span>
    <span class="guide__title">Sådan virker kladden</span>
    <span class="guide__meta">{open ? 'Skjul' : 'Vis vejledning'}</span>
  </summary>
  <div class="guide__body">
    <section>
      <h4>Kladde og udstedelse</h4>
      <p>
        En kladde har intet nummer, og du kan rette og slette den frit. Når du trykker <strong>Udsted</strong>, får fakturaen
        det næste nummer i serien, PDF'en gemmes, og fakturaen låses. Gem kladden og se udkastet som PDF, før du udsteder.
      </p>
    </section>
    <section>
      <h4>Timer på fakturaen</h4>
      <p>
        Den loggede tid er låst, så snart den ligger på en kladde. Det, du retter her, er det, kunden ser: timer, tekst og
        timepris. Under hvert beløb står afvigelsen fra den loggede tid. ✕ sender en linje tilbage som ufaktureret, og
        sletter du kladden, bliver alle dens timer ufaktureret igen.
      </p>
    </section>
    <section>
      <h4>Overskrifter</h4>
      <p>
        Vil du have flere registreringer som én linje, tilføjer du en overskrift og rykker linjerne ind under den. Kunden ser
        overskriftens tekst med summen af timer og beløb, og prisen pr. time er beløbet delt med timerne. Kun teksten på
        overskriften kan rettes.
      </p>
    </section>
    <section>
      <h4>Efter udstedelse</h4>
      <p>
        En udstedt faktura kan ikke ændres. Er der en fejl, opretter du en kreditnota fra fakturasiden og laver en ny faktura.
        Timerne bliver stående som faktureret på den krediterede faktura, så rettelsen skriver du selv på den nye.
      </p>
    </section>
    <section>
      <h4>Tastatur</h4>
      <p>
        I timetabellen rykker <kbd>Alt</kbd>+<kbd>→</kbd> en linje ind under overskriften over den, og <kbd>Alt</kbd>+<kbd>←</kbd>
        rykker den ud igen. <kbd>Alt</kbd>+<kbd>↑</kbd> og <kbd>Alt</kbd>+<kbd>↓</kbd> flytter linjen.
      </p>
    </section>
  </div>
</details>

<style>
  .guide {
    margin: 0 0 var(--space-6);
    border: var(--border-default-style);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .guide summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    list-style: none;
  }
  .guide summary::-webkit-details-marker { display: none; }
  .guide summary:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: var(--focus-ring-offset); border-radius: var(--radius-md); }
  .guide__icon {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    font: italic var(--weight-medium) 11px/1 var(--font-ui);
  }
  .guide__title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-primary); }
  .guide__meta { margin-left: auto; font-size: var(--text-xs); color: var(--text-link); }
  .guide[open] summary { border-bottom: var(--border-hairline-style); }
  .guide__body {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
    gap: var(--space-4) var(--layout-column-gap);
    padding: var(--space-4);
  }
  .guide h4 { margin: 0 0 var(--space-1); font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-label); }
  .guide p { margin: 0; font-size: var(--text-xs); line-height: 1.55; color: var(--text-body); }
  .guide kbd {
    padding: 0 3px;
    border: var(--border-default-style);
    border-radius: var(--radius-xs);
    background: var(--bg-surface-sunk);
    font: var(--text-2xs) var(--font-numeric);
  }
</style>
