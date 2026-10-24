/**
 * Generates the documentation pages for the MCP server from the server itself, so the site can
 * never disagree with the code:
 *
 *   site/mcp/tools.html         one card per tool, from tools/list over an in-memory transport
 *                               (name, title, description, input schema, annotations) plus a
 *                               Danish example prompt per tool, kept in PROMPTS below
 *   site/mcp/architecture.html  the file table and dependency list between gen-markers
 *
 * No app, no token and no network: the server starts with a dummy config and only lists its tools.
 *
 *   npx tsx scripts/docs.ts            write the files
 *   npx tsx scripts/docs.ts --check    exit 1 if the files on disk differ from what would be written
 *
 * A new tool without an entry in PROMPTS fails the run: documenting it is part of adding it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, SERVER_INFO } from '../src/server.js';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_DIR = path.resolve(PACKAGE_DIR, '..', 'site', 'mcp');
const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Hand-written parts: one Danish prompt per tool, and what each source file is for.

const PROMPTS: Record<string, string> = {
  list_invoices: 'Hvilke fakturaer forfalder snart?',
  get_invoice: 'Vis mig faktura 1004.',
  list_expenses: 'Hvilke udgifter har jeg ikke betalt endnu?',
  cash_position: 'Hvad står jeg i banken?',
  cashflow: 'Hvordan ser cashflowet ud frem til nytår?',
  vat_report: 'Hvad skal jeg indberette i moms for 2. kvartal?',
  resultat: 'Hvad er resultatet for året indtil nu, fordelt på konti?',
  budget_status: 'Hvordan ligger jeg i forhold til budgettet?',
  list_accounts: 'Hvilke omkostningskonti har jeg?',
  list_customers: 'Hvilken betalingsfrist har Nordhavn Arkitekter?',
  list_time: 'Hvor mange ufakturerede timer har jeg, og hvad er de værd?',
  mark_invoice_paid: 'Faktura 1004 blev betalt i går.',
  create_cash_movement: 'Bogfør bankgebyret på 45 kr fra i går.',
  reconcile_balance: 'Registrér min saldo: 84.250 kr.',
  create_draft_invoice: 'Lav en kladde til Nordhavn Arkitekter: 12 timer rådgivning à 950 kr.',
  create_expense: 'Opret en udgift: Hetzner, serverhosting september, 380 kr uden moms, konto 2000.',
  log_time: 'Log 2,5 timer hos Nordhavn i dag: workshop om tilgængelighed.',
  create_draft_from_time: 'Lav en kladde med Vestergaards timer fra oktober.'
};

const FILE_PURPOSE: Record<string, string> = {
  'stdio.ts': 'stdio-transport til lokale klienter (Claude Code, Claude Desktop, MCP Inspector)',
  'http.ts': 'streamable HTTP på <code>/mcp</code> med Host-validering, og <code>/healthz</code>',
  'server.ts': 'opretter MCP-serveren med dens instruktion og registrerer værktøjerne',
  'tools.ts': 'værktøjerne: skemaer, beskrivelser og formning af svar',
  'client.ts': 'typet HTTP-klient til appens JSON-API; kun GET og POST findes',
  'config.ts': '<code>FAKTURA_URL</code> og token fra miljøet og de to valgfrie .env-filer',
  'format.ts': 'øre til <code>1.234,56 kr.</code>, datoer, kvartaler og momsfrister'
};

// ---------------------------------------------------------------------------
// Helpers

type Schema = {
  $ref?: string;
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  maxItems?: number;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
};

interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Schema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The SDK's JSON-schema conversion emits a reused Zod schema (isoDate, for one) as {"$ref": "#/properties/x"}
 * the second time it sees it. Resolve that against the tool's root schema, keeping the node's own description.
 */
function resolve(s: Schema, root: Schema): Schema {
  if (!s.$ref) return s;
  if (!s.$ref.startsWith('#/')) throw new Error(`unsupported $ref ${s.$ref}`);
  let node: unknown = root;
  for (const key of s.$ref.slice(2).split('/')) node = (node as Record<string, unknown>)[key];
  if (!node) throw new Error(`unresolvable $ref ${s.$ref}`);
  const { $ref: _ignored, ...own } = s;
  return { ...resolve(node as Schema, root), ...own };
}

/** Short Danish type label for a JSON-schema node. */
function typeLabel(s: Schema): string {
  if (s.enum) return s.enum.map((v) => `<code>${esc(String(v))}</code>`).join(' · ');
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === 'string' && s.pattern && /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(s.pattern)) return 'dato <span class="sub">(åååå-mm-dd)</span>';
  if (t === 'string') return 'tekst';
  if (t === 'boolean') return 'ja/nej';
  if (t === 'integer' || t === 'number') {
    const range =
      s.minimum !== undefined && s.maximum !== undefined
        ? ` <span class="sub">(${s.minimum}–${s.maximum})</span>`
        : s.exclusiveMinimum !== undefined || (s.minimum !== undefined && s.minimum > 0)
          ? ' <span class="sub">(positivt)</span>'
          : '';
    return (t === 'integer' ? 'heltal' : 'tal') + range;
  }
  if (t === 'array') {
    const n = s.minItems !== undefined && s.maxItems !== undefined ? ` <span class="sub">(${s.minItems}–${s.maxItems})</span>` : '';
    return `liste af ${s.items?.type === 'object' ? 'objekter' : s.items ? typeLabel(s.items) : 'værdier'}${n}`;
  }
  if (t === 'object') return 'objekt';
  return esc(t ?? 'værdi');
}

/** Rows for an object schema; nested object arrays are flattened as name[].field. */
function argRows(schema: Schema, root: Schema = schema, prefix = ''): string[] {
  const rows: string[] = [];
  const required = new Set(schema.required ?? []);
  for (const [name, raw] of Object.entries(schema.properties ?? {})) {
    const s = resolve(raw, root);
    const full = prefix + name;
    const req = required.has(name) ? 'ja' : `<span class="sub">nej${s.default !== undefined ? `, standard <code>${esc(JSON.stringify(s.default))}</code>` : ''}</span>`;
    rows.push(`<tr><td><code>${esc(full)}</code></td><td>${typeLabel(s)}</td><td>${req}</td><td>${esc(s.description ?? '')}</td></tr>`);
    if (s.items?.type === 'object') rows.push(...argRows(s.items, root, `${full}[].`));
  }
  return rows;
}

function toolCard(t: Tool): string {
  const read = t.annotations?.readOnlyHint === true;
  const rows = argRows(t.inputSchema);
  const args = rows.length
    ? `<table><thead><tr><th>Argument</th><th>Type</th><th>Krævet</th><th>Betydning</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="small">Ingen argumenter.</p>';
  const hints: string[] = [];
  if (!read) {
    hints.push(t.annotations?.idempotentHint ? 'kan gentages uden at ændre mere' : 'tilføjer en række pr. kald');
    hints.push(t.annotations?.destructiveHint === false ? 'sletter eller ændrer ingenting, der findes' : 'destruktiv');
  }
  const desc = (t.description ?? '')
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
  return `<section class="tool" id="${esc(t.name)}">
<div class="tool__head"><h3>${esc(t.title ?? t.name)}</h3><code>${esc(t.name)}</code><span class="badge badge--${read ? 'read' : 'write'}">${read ? 'læser' : 'skriver'}</span></div>
<div class="tool__desc" lang="en">${desc}</div>
${args}
<p class="prompt">Prøv: <q>${esc(PROMPTS[t.name])}</q>${hints.length ? ` <span class="sub">· ${hints.join(' · ')}</span>` : ''}</p>
</section>`;
}

function toolsPage(tools: Tool[], instructions: string): string {
  const reads = tools.filter((t) => t.annotations?.readOnlyHint === true);
  const writes = tools.filter((t) => t.annotations?.readOnlyHint !== true);
  const toc = (list: Tool[]) => `<ul class="toc">${list.map((t) => `<li><a href="#${esc(t.name)}">${esc(t.title ?? t.name)}</a> <code class="sub">${esc(t.name)}</code></li>`).join('')}</ul>`;
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kvit MCP — hvad AI'en kan</title>
<meta name="description" content="Alle ${tools.length} værktøjer i Kvits MCP-server: ${reads.length} der læser, ${writes.length} der skriver, og de tre handlinger, der med vilje mangler.">
<link rel="stylesheet" href="../tokens.css">
<link rel="stylesheet" href="./mcp.css">
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
</head>
<body>
<header class="rail">
  <div class="rail__inner">
    <a class="brand" href="../">
      <img src="../logo.svg" width="26" height="26" alt="">
      <span class="brand__name">Kvit<span class="brand__sub">MCP-server</span></span>
    </a>
    <nav>
      <a href="./">Tilslut</a>
      <a href="./tools.html" aria-current="page">Værktøjer</a>
      <a href="./architecture.html">Opbygning</a>
      <a href="../">Kvit</a>
    </nav>
  </div>
</header>

<main class="wrap">
  <p class="kicker">Kvit MCP · værktøjer</p>
  <h1>Hvad AI'en kan, og hvad den ikke kan</h1>
  <p class="lede">MCP-serveren har ${tools.length} værktøjer: ${reads.length} der læser, og ${writes.length} der skriver. Denne side er lavet af serveren selv: navne, beskrivelser og argumenter er dem, en assistent ser, når den kobler sig på. Beskrivelserne er på engelsk, fordi assistenten læser dem; dataene er danske.</p>

  <div class="note">
    <p><strong>Tre ting kan den ikke.</strong> Udstede fakturaer, oprette kreditnotaer og slette noget. De to første tager numre fra den lovpligtige serie og kan ikke gøres om; sletning hører ikke til i et bogholderi. Der findes heller ikke et værktøj, der redigerer et udstedt dokument eller en logget time. Assistenten kan lave kladden og sige det, men <em>Udsted</em> trykker du selv i programmet.</p>
    <p>Alt, der skrives via MCP, står i revisionssporet med afsender <code>api</code>, så du altid kan se, hvad der kom fra AI'en.</p>
  </div>

  <h2>Sådan svarer værktøjerne</h2>
  <ul>
    <li>Beløb kommer både som heltal i øre (<code>amount_ore</code>) og formateret (<code>amount_formatted</code>, fx <code>1.234,56 kr.</code>).</li>
    <li>Datoer er ISO 8601, kvartaler skrives <code>2026-Q3</code>.</li>
    <li>Fejl fra programmet sendes videre som de er, med HTTP-status og programmets egen danske besked. Et 409 på en uforanderlighedsregel bliver til en fejl med <code>retry: false</code>; assistenten bliver bedt om at sige det til dig i stedet for at prøve igen.</li>
    <li>Serveren præsenterer sig for assistenten med denne instruktion:</li>
  </ul>
  <pre lang="en">${esc(instructions)}</pre>

  <h2>Læser <span class="sub">(${reads.length})</span></h2>
  ${toc(reads)}
  ${reads.map(toolCard).join('\n')}

  <h2>Skriver <span class="sub">(${writes.length})</span></h2>
  <p>Alle skriveværktøjer tilføjer en række eller sætter en dato, der kan rettes i programmet. Ingen af dem sletter eller overskriver.</p>
  ${toc(writes)}
  ${writes.map(toolCard).join('\n')}

  <p class="foot">Genereret fra <code>${esc(SERVER_INFO.name)} ${esc(SERVER_INFO.version)}</code> med <code>npm --prefix mcp run docs</code>. Tilføjer man et værktøj uden et eksempel på dansk, fejler genereringen.</p>
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// architecture.html: file table and dependencies between markers

function replaceBlock(html: string, name: string, body: string): string {
  const start = `<!-- gen:${name} -->`;
  const end = `<!-- /gen:${name} -->`;
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`architecture.html: markers ${start} … ${end} not found`);
  return html.slice(0, a + start.length) + '\n' + body + '\n' + html.slice(b);
}

function architecturePage(existing: string, tools: Tool[]): string {
  const srcDir = path.join(PACKAGE_DIR, 'src');
  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ name: f, lines: fs.readFileSync(path.join(srcDir, f), 'utf8').split('\n').filter((l) => l.trim()).length }));
  const order = Object.keys(FILE_PURPOSE);
  files.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  for (const f of files) if (!FILE_PURPOSE[f.name]) throw new Error(`FILE_PURPOSE lacks an entry for src/${f.name}`);
  const total = files.reduce((s, f) => s + f.lines, 0);
  const table = `<table>
<thead><tr><th>Fil</th><th>Linjer</th><th>Gør</th></tr></thead>
<tbody>
${files.map((f) => `<tr><td><code>src/${esc(f.name)}</code></td><td class="num">${f.lines}</td><td>${FILE_PURPOSE[f.name]}</td></tr>`).join('\n')}
<tr><td><strong>I alt</strong></td><td class="num"><strong>${total}</strong></td><td>${files.length} filer, ${tools.length} værktøjer; tomme linjer er ikke talt med</td></tr>
</tbody>
</table>`;

  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const deps = `<ul>
${Object.keys(pkg.dependencies)
  .map((d) => `<li><code>${esc(d)}</code></li>`)
  .join('\n')}
</ul>
<p class="small">Til udvikling desuden ${Object.keys(pkg.devDependencies)
    .map((d) => `<code>${esc(d)}</code>`)
    .join(', ')}.</p>`;

  return replaceBlock(replaceBlock(existing, 'files', table), 'deps', deps);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = createServer({ baseUrl: 'http://127.0.0.1:3000', token: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'kvit-mcp-docs', version: SERVER_INFO.version });
  await client.connect(clientTransport);
  const tools = (await client.listTools()).tools as unknown as Tool[];
  const instructions = client.getInstructions() ?? '';
  await client.close();
  await server.close();

  const missing = tools.filter((t) => !PROMPTS[t.name]).map((t) => t.name);
  const extra = Object.keys(PROMPTS).filter((n) => !tools.some((t) => t.name === n));
  if (missing.length || extra.length) {
    throw new Error(`PROMPTS out of sync with the server. Missing: ${missing.join(', ') || '-'}. Unknown: ${extra.join(', ') || '-'}.`);
  }

  const outputs: { file: string; text: string }[] = [
    { file: path.join(SITE_DIR, 'tools.html'), text: toolsPage(tools, instructions) }
  ];
  const archFile = path.join(SITE_DIR, 'architecture.html');
  outputs.push({ file: archFile, text: architecturePage(fs.readFileSync(archFile, 'utf8'), tools) });

  let stale = 0;
  for (const o of outputs) {
    const current = fs.existsSync(o.file) ? fs.readFileSync(o.file, 'utf8') : null;
    if (current === o.text) continue;
    stale++;
    if (CHECK) console.error(`[docs] ${path.relative(PACKAGE_DIR, o.file)} is out of date; run npm run docs`);
    else {
      fs.writeFileSync(o.file, o.text);
      console.error(`[docs] wrote ${path.relative(PACKAGE_DIR, o.file)}`);
    }
  }
  if (CHECK && stale) process.exit(1);
  if (!stale) console.error('[docs] up to date');
}

main().catch((e) => {
  console.error(`[docs] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
