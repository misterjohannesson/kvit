/**
 * The kontoplan as a spreadsheet round trip. Download gives one row per account; upload applies the file as the
 * desired state of the kontoplan, keyed by kontonr: rows for existing numbers update name, group and archived, new
 * numbers are created, and (only with `prune`) accounts missing from the file are deleted when nothing references
 * them. The whole upload is one transaction: any error anywhere and nothing changes.
 */
import { z } from 'zod';
import { db } from '../db';
import { audit } from '../audit';
import { badRequest, conflict } from '../errors';
import { parseCsv, toCsv } from '../../csv';
import {
  accountNumberSchema,
  accountTypeLabel,
  accountUsageMap,
  archivedSchema,
  createAccount,
  deleteAccount,
  listAccounts,
  listActiveAccounts,
  updateAccount,
  type AccountInput,
  type AccountType
} from './accounts';

export const KONTOPLAN_HEADER = ['kontonr', 'navn', 'type', 'gruppe', 'arkiveret'] as const;
export const KONTOPLAN_FILE_NAME = 'kontoplan.csv';
/** A kontoplan is a few hundred rows at most; anything bigger is the wrong file. */
export const KONTOPLAN_MAX_BYTES = 256 * 1024;

/** `kontonr;navn;type;gruppe;arkiveret`, Danish labels (salg/omkostning, ja/nej), BOM + CRLF for Excel. */
export function kontoplanCsv(): string {
  return toCsv(
    [...KONTOPLAN_HEADER],
    listAccounts().map((a) => [a.number, a.name, accountTypeLabel(a.type), a.group, a.archived ? 'ja' : 'nej'])
  );
}

/**
 * An optional, larger grouped kontoplan for owners who want more than the eleven default accounts. Offered as a
 * download from Indstillinger and applied by uploading it; it keeps the eleven defaults (same numbers) and adds
 * accounts for a one-person business with staff costs, direct costs and finance items.
 */
export const KONTOPLAN_TEMPLATE_FILE_NAME = 'kontoplan-udvidet.csv';
const TEMPLATE_ROWS: [number, string, AccountType, string][] = [
  [1000, 'Konsulentydelser', 'revenue', 'Omsætning'],
  [1100, 'Andet salg', 'revenue', 'Omsætning'],
  [1200, 'Momsfrit salg', 'revenue', 'Omsætning'],
  [1300, 'Salg til EU-kunder (omvendt betalingspligt)', 'revenue', 'Omsætning'],
  [1400, 'Salg uden for EU', 'revenue', 'Omsætning'],
  [1500, 'Viderefakturerede udlæg', 'revenue', 'Omsætning'],
  [2000, 'Software og hosting', 'cost', 'IT og software'],
  [2050, 'Hardware og IT-udstyr', 'cost', 'IT og software'],
  [2100, 'Kontorhold', 'cost', 'Kontor og lokaler'],
  [2110, 'Husleje og kontorplads', 'cost', 'Kontor og lokaler'],
  [2120, 'Telefon og internet', 'cost', 'Kontor og lokaler'],
  [2130, 'Inventar og småanskaffelser', 'cost', 'Kontor og lokaler'],
  [2200, 'Repræsentation', 'cost', 'Salg og repræsentation'],
  [2300, 'Rejser og transport', 'cost', 'Rejser og transport'],
  [2310, 'Kørselsgodtgørelse', 'cost', 'Rejser og transport'],
  [2400, 'Forsikring og kontingenter', 'cost', 'Administration'],
  [2500, 'Revisor og rådgivning', 'cost', 'Administration'],
  [2550, 'Faglitteratur og abonnementer', 'cost', 'Administration'],
  [2600, 'Markedsføring', 'cost', 'Salg og repræsentation'],
  [2900, 'Øvrige omkostninger', 'cost', 'Øvrige'],
  [3000, 'Underleverandører og freelancere', 'cost', 'Direkte omkostninger'],
  [3100, 'Varekøb og materialer', 'cost', 'Direkte omkostninger'],
  [3200, 'Udlæg for kunder', 'cost', 'Direkte omkostninger'],
  [4000, 'Løn', 'cost', 'Personale'],
  [4100, 'Pension og sociale bidrag', 'cost', 'Personale'],
  [4200, 'Kurser og uddannelse', 'cost', 'Personale'],
  [7000, 'Renteudgifter', 'cost', 'Afskrivninger og finansielle poster'],
  [7100, 'Gebyrer (bank og betaling)', 'cost', 'Afskrivninger og finansielle poster'],
  [7500, 'Afskrivninger', 'cost', 'Afskrivninger og finansielle poster']
];

/** The template, with the owner's current names kept for numbers that already exist so a download never renames anything. */
export function kontoplanTemplateCsv(): string {
  const current = new Map(listAccounts().map((a) => [a.number, a]));
  return toCsv(
    [...KONTOPLAN_HEADER],
    TEMPLATE_ROWS.map(([number, name, type, group]) => {
      const own = current.get(number);
      return [number, own?.name ?? name, accountTypeLabel(own?.type ?? type), own?.group || group, own?.archived ? 'ja' : 'nej'];
    })
  );
}

const HEADER_ALIASES: Record<(typeof KONTOPLAN_HEADER)[number], string[]> = {
  kontonr: ['kontonr', 'kontonummer', 'konto', 'nummer', 'number', 'account'],
  navn: ['navn', 'name', 'kontonavn'],
  type: ['type', 'art'],
  gruppe: ['gruppe', 'group', 'kontogruppe'],
  arkiveret: ['arkiveret', 'archived', 'arkiv']
};

const typeCell = z.preprocess(
  (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (['salg', 'revenue', 'omsætning', 'indtægt'].includes(s)) return 'revenue';
    if (['omkostning', 'cost', 'udgift', 'omkostninger'].includes(s)) return 'cost';
    return s;
  },
  z.enum(['revenue', 'cost'], { message: 'type skal være salg eller omkostning' })
);

const rowSchema = z.object({
  number: accountNumberSchema,
  name: z.string().trim().min(1, 'navn er påkrævet').max(100, 'navn må højst være 100 tegn'),
  type: typeCell,
  group: z.string().trim().max(60, 'gruppe må højst være 60 tegn'),
  archived: archivedSchema
});

export interface KontoplanRow extends AccountInput {
  line: number;
}

/** Header check, then every row; all problems are reported together. */
export function parseKontoplanCsv(text: string): { rows: KontoplanRow[]; errors: string[] } {
  const errors: string[] = [];
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (e) {
    return { rows: [], errors: [(e as Error).message] };
  }
  if (!parsed.rows.length) return { rows: [], errors: ['Filen er tom'] };

  const header = parsed.rows[0].cells.map((c) => c.trim().toLowerCase());
  const col: Partial<Record<(typeof KONTOPLAN_HEADER)[number], number>> = {};
  for (const key of KONTOPLAN_HEADER) {
    const idx = header.findIndex((h) => HEADER_ALIASES[key].includes(h));
    if (idx >= 0) col[key] = idx;
  }
  for (const key of ['kontonr', 'navn', 'type'] as const) {
    if (col[key] === undefined) errors.push(`Overskriften mangler kolonnen "${key}" (forventet: ${KONTOPLAN_HEADER.join(';')})`);
  }
  if (errors.length) return { rows: [], errors };

  const cell = (cells: string[], key: (typeof KONTOPLAN_HEADER)[number]) => (col[key] === undefined ? '' : (cells[col[key]] ?? ''));
  const rows: KontoplanRow[] = [];
  const seen = new Map<number, number>();
  for (const r of parsed.rows.slice(1)) {
    const res = rowSchema.safeParse({
      number: cell(r.cells, 'kontonr').trim(),
      name: cell(r.cells, 'navn'),
      type: cell(r.cells, 'type'),
      group: cell(r.cells, 'gruppe'),
      archived: cell(r.cells, 'arkiveret')
    });
    if (!res.success) {
      errors.push(`Linje ${r.line}: ${res.error.issues.map((i) => i.message).join(', ')}`);
      continue;
    }
    const first = seen.get(res.data.number);
    if (first !== undefined) {
      errors.push(`Linje ${r.line}: kontonr ${res.data.number} står også på linje ${first}`);
      continue;
    }
    seen.set(res.data.number, r.line);
    rows.push({ ...res.data, line: r.line });
  }
  if (!rows.length && !errors.length) errors.push('Filen har ingen konti under overskriften');
  return { rows, errors };
}

export interface KontoplanImportResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  /** Accounts in the kontoplan that the file did not mention and that were kept (prune off). */
  kept: number;
  accounts: number;
}

function tooMany(messages: string[]): string {
  const shown = messages.slice(0, 12);
  const rest = messages.length - shown.length;
  return shown.join(' · ') + (rest > 0 ? ` · og ${rest} til` : '');
}

/**
 * Apply an uploaded kontoplan. Errors are collected before anything is written; the writes then run in one
 * transaction through the ordinary account functions, so each change gets its own audit row plus one summary row.
 */
export function importKontoplan(text: string, options: { prune?: boolean } = {}): KontoplanImportResult {
  if (Buffer.byteLength(text, 'utf8') > KONTOPLAN_MAX_BYTES) throw badRequest('Filen er for stor til at være en kontoplan (maks. 256 KB)');
  const { rows, errors } = parseKontoplanCsv(text);
  if (errors.length) throw badRequest(tooMany(errors));

  return db.transaction(() => {
    const existing = new Map(listAccounts().map((a) => [a.number, a]));
    const usage = accountUsageMap();
    const problems: string[] = [];
    const inFile = new Set(rows.map((r) => r.number));

    for (const r of rows) {
      const cur = existing.get(r.number);
      if (cur && cur.type !== r.type) {
        problems.push(`Linje ${r.line}: konto ${r.number} er en ${accountTypeLabel(cur.type)}skonto og kan ikke blive til ${accountTypeLabel(r.type)} (type kan ikke ændres; opret et nyt nummer)`);
      }
    }
    const toDelete = options.prune ? [...existing.values()].filter((a) => !inFile.has(a.number)) : [];
    for (const a of toDelete) {
      if ((usage.get(a.id) ?? 0) > 0) {
        problems.push(`Konto ${a.number} ${a.name} er i brug og står ikke i filen; tilføj den igen (evt. med arkiveret = ja)`);
      }
    }
    // The end state must leave something to book on.
    for (const type of ['revenue', 'cost'] as AccountType[]) {
      const active = [...existing.values()].filter((a) => a.type === type && !toDelete.includes(a)).map((a) => {
        const r = rows.find((x) => x.number === a.number);
        return r ? !r.archived : !a.archived;
      });
      const created = rows.filter((r) => !existing.has(r.number) && r.type === type && !r.archived).length;
      if (!active.some(Boolean) && created === 0) {
        problems.push(type === 'revenue' ? 'Kontoplanen skal have mindst én aktiv salgskonto' : 'Kontoplanen skal have mindst én aktiv omkostningskonto');
      }
    }
    if (problems.length) throw conflict(tooMany(problems));

    const result: KontoplanImportResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, kept: 0, accounts: 0 };
    // Creates first and un-archives before archives, so the "last active account" guard never trips on ordering.
    for (const r of rows.filter((x) => !existing.has(x.number))) {
      createAccount({ number: r.number, name: r.name, type: r.type, group: r.group, archived: r.archived });
      result.created++;
    }
    const updates = rows.filter((x) => existing.has(x.number)).sort((a, b) => Number(a.archived) - Number(b.archived));
    for (const r of updates) {
      const cur = existing.get(r.number)!;
      if (cur.name === r.name && cur.group === r.group && cur.archived === r.archived) {
        result.unchanged++;
        continue;
      }
      updateAccount(cur.id, { name: r.name, group: r.group, archived: r.archived });
      result.updated++;
    }
    for (const a of toDelete) {
      deleteAccount(a.id);
      result.deleted++;
    }
    result.kept = options.prune ? 0 : [...existing.values()].filter((a) => !inFile.has(a.number)).length;
    result.accounts = listAccounts().length;
    if (!listActiveAccounts('revenue').length || !listActiveAccounts('cost').length) {
      throw conflict('Kontoplanen skal have mindst én aktiv salgskonto og én aktiv omkostningskonto');
    }
    audit('account', 0, 'import', { ...result, prune: !!options.prune, rows: rows.length });
    return result;
  });
}

/** One Danish sentence for the settings page and the API response. */
export function describeImport(r: KontoplanImportResult): string {
  const parts = [`${r.created} oprettet`, `${r.updated} ændret`, `${r.deleted} slettet`, `${r.unchanged} uændret`];
  if (r.kept) parts.push(`${r.kept} ikke nævnt i filen og beholdt`);
  return `Kontoplan indlæst: ${parts.join(', ')}. Kontoplanen har nu ${r.accounts} konti.`;
}
