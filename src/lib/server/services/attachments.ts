/**
 * Invoice attachments: PDFs the owner appends to a draft (time sheets, product
 * lists) so the issued document is one collected PDF. Attachments belong to the
 * draft stage only; once the invoice is issued they are frozen with it (database
 * triggers invoice_attachment_no_*_issued) and their pages live inside the
 * archived {number}.pdf. The uploaded originals stay under files/invoices/bilag/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { db } from '../db';
import { invoice, invoiceAttachment, type InvoiceAttachment } from '../schema';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';
import { DATA_DIR, INVOICE_FILES_DIR } from '../env';
import { sniffUploadExt, type UploadFile } from './expenses';
import { withIssueLock } from './issue-lock';

export const MAX_ATTACHMENTS = 20;
const ATTACHMENT_DIR = path.join(INVOICE_FILES_DIR, 'bilag');

export function listAttachments(invoiceId: number): InvoiceAttachment[] {
  return db
    .select()
    .from(invoiceAttachment)
    .where(eq(invoiceAttachment.invoiceId, invoiceId))
    .orderBy(asc(invoiceAttachment.position), asc(invoiceAttachment.id))
    .all();
}

export function attachmentAbsolutePath(a: InvoiceAttachment): string {
  return path.join(DATA_DIR, a.filePath);
}

export function getAttachment(invoiceId: number, attachmentId: number): InvoiceAttachment {
  const a = db.select().from(invoiceAttachment).where(eq(invoiceAttachment.id, attachmentId)).get();
  if (!a || a.invoiceId !== invoiceId) throw notFound('Bilaget findes ikke');
  return a;
}

/** Page count from the file itself; also proves the bytes are a PDF pdf-lib can read and merge. */
export async function pdfPageCount(bytes: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    throw badRequest('PDF-filen kunne ikke læses; er den beskadiget eller kodeordsbeskyttet?');
  }
}

/** Keep the name the owner will recognise, without any path or control characters. */
function cleanName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
  return cleaned || 'bilag.pdf';
}

function requireDraft(invoiceId: number) {
  const inv = db.select().from(invoice).where(eq(invoice.id, invoiceId)).get();
  if (!inv) throw notFound('Faktura findes ikke');
  if (inv.status !== 'draft') {
    throw conflict(`Faktura ${inv.invoiceNumber ?? inv.id} er udstedt; bilag kan ikke ændres. Opret en kreditnota i stedet.`);
  }
  return inv;
}

/** Append a PDF to a draft. Runs under the issue lock so it cannot interleave with an issue in progress. */
export function addAttachment(invoiceId: number, file: UploadFile): Promise<InvoiceAttachment> {
  return withIssueLock(async () => {
    requireDraft(invoiceId);
    if (sniffUploadExt(file.bytes) !== 'pdf') throw badRequest('Kun PDF kan vedhæftes en faktura');
    const pages = await pdfPageCount(file.bytes);
    if (pages === 0) throw badRequest('PDF-filen har ingen sider');
    const existing = listAttachments(invoiceId);
    if (existing.length >= MAX_ATTACHMENTS) throw badRequest(`Højst ${MAX_ATTACHMENTS} bilag pr. faktura`);

    fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });
    const relPath = path.posix.join('files', 'invoices', 'bilag', `${invoiceId}-${randomUUID()}.pdf`);
    const abs = path.join(DATA_DIR, relPath);
    fs.writeFileSync(abs, file.bytes);
    try {
      return db.transaction(() => {
        requireDraft(invoiceId);
        const position = (existing[existing.length - 1]?.position ?? 0) + 1;
        const row = db
          .insert(invoiceAttachment)
          .values({ invoiceId, position, name: cleanName(file.name), filePath: relPath, pages, sizeBytes: file.bytes.length, createdAt: new Date().toISOString() })
          .returning()
          .get();
        audit('invoice', invoiceId, 'attach', { attachmentId: row.id, name: row.name, pages, sizeBytes: row.sizeBytes, filePath: relPath });
        return row;
      });
    } catch (e) {
      fs.rmSync(abs, { force: true });
      throw e;
    }
  });
}

/** Remove an attachment from a draft; the file goes once the row is gone. */
export function removeAttachment(invoiceId: number, attachmentId: number): Promise<void> {
  return withIssueLock(async () => {
    const abs = db.transaction(() => {
      requireDraft(invoiceId);
      const a = getAttachment(invoiceId, attachmentId);
      db.delete(invoiceAttachment).where(eq(invoiceAttachment.id, a.id)).run();
      audit('invoice', invoiceId, 'detach', { attachmentId: a.id, name: a.name, filePath: a.filePath });
      return attachmentAbsolutePath(a);
    });
    fs.rmSync(abs, { force: true });
  });
}

/**
 * For deleteDraft (already inside its transaction and lock): drop the rows and
 * return the files to remove after commit.
 */
export function detachAllForDelete(invoiceId: number): string[] {
  const rows = listAttachments(invoiceId);
  db.delete(invoiceAttachment).where(eq(invoiceAttachment.invoiceId, invoiceId)).run();
  return rows.map(attachmentAbsolutePath);
}

export function attachmentBuffers(invoiceId: number): Buffer[] {
  return listAttachments(invoiceId).map((a) => {
    const abs = attachmentAbsolutePath(a);
    if (!fs.existsSync(abs)) throw conflict(`Bilaget ${a.name} mangler på disken (${a.filePath})`);
    return fs.readFileSync(abs);
  });
}

/**
 * The invoice pages first, then every attachment in order. With no attachments
 * the rendered bytes are returned untouched.
 */
export async function mergePdfs(main: Buffer, extra: Buffer[]): Promise<Buffer> {
  if (extra.length === 0) return main;
  const doc = await PDFDocument.load(main, { updateMetadata: false });
  for (const bytes of extra) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const pages = await doc.copyPages(src, src.getPageIndices());
    for (const p of pages) doc.addPage(p);
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

export function countAttachments(): number {
  return db.select({ n: sql<number>`count(*)` }).from(invoiceAttachment).get()?.n ?? 0;
}
