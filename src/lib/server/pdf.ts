import { chromium, type Browser } from 'playwright';
import { readTokensCss, tokenValue } from './assets';
import { renderInvoiceHtml } from './invoice-template';
import type { InvoiceDetail } from './services/invoices';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  const b = await browserPromise;
  if (!b.isConnected()) {
    browserPromise = null;
    return getBrowser();
  }
  return b;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close();
  }
}

/** Render HTML to a PDF buffer with headless Chromium under print media. */
export async function htmlToPdf(html: string, footerTemplate: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      preferCSSPageSize: false,
      printBackground: false,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate,
      margin: {
        top: tokenValue('--print-margin-top'),
        right: tokenValue('--print-margin-side'),
        bottom: tokenValue('--print-margin-bottom'),
        left: tokenValue('--print-margin-side')
      }
    });
  } finally {
    await page.close();
  }
}

export async function renderInvoicePdf(inv: InvoiceDetail, settings: Record<string, string>): Promise<Buffer> {
  const { html, footerTemplate } = renderInvoiceHtml(inv, settings, readTokensCss());
  return htmlToPdf(html, footerTemplate);
}
