<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A small "i" next to a label or column head that opens a short explanation. Uses the popover API, so the bubble
   * sits in the top layer (no clipping by scrolling tables) and closes on Escape or a click elsewhere.
   */
  let { label = 'Forklaring', children }: { label?: string; children: Snippet } = $props();
  const id = $props.id();
  let button: HTMLButtonElement;
  let bubble: HTMLDivElement;

  const GAP = 6;
  const EDGE = 12;

  /** Below the button, centred on it, kept inside the window; above it when there is no room below. */
  function place() {
    const r = button.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 2 * EDGE);
    bubble.style.width = `${w}px`;
    bubble.style.left = `${Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), window.innerWidth - w - EDGE)}px`;
    bubble.style.top = `${r.bottom + GAP}px`;
    const h = bubble.getBoundingClientRect().height;
    if (r.bottom + GAP + h > window.innerHeight - EDGE && r.top - GAP - h > EDGE) bubble.style.top = `${r.top - GAP - h}px`;
  }
</script>

<button type="button" class="infotip" popovertarget="tip-{id}" aria-label={label} aria-describedby="tip-{id}" bind:this={button}>i</button>
<div id="tip-{id}" popover="auto" role="tooltip" class="infotip__bubble" bind:this={bubble} ontoggle={(e) => (e as ToggleEvent).newState === 'open' && place()}>
  {@render children()}
</div>

<style>
  .infotip {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-left: var(--space-1);
    padding: 0;
    vertical-align: text-bottom;
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font: italic var(--weight-medium) 10px/1 var(--font-ui);
    text-transform: none;
    letter-spacing: 0;
    cursor: help;
  }
  .infotip:hover { color: var(--text-primary); border-color: var(--text-secondary); }
  .infotip:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: var(--focus-ring-offset); }
  .infotip__bubble {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: var(--space-3);
    border: var(--border-default-style);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: var(--shadow-dropdown);
    color: var(--text-body);
    font: var(--weight-regular) var(--text-xs) / 1.5 var(--font-ui);
    text-align: left;
    text-transform: none;
    letter-spacing: 0;
    white-space: normal;
  }
</style>
