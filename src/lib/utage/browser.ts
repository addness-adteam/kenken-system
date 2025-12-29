import puppeteer, { Browser, Page, Cookie } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

let browserInstance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  const executablePath = await chromium.executablePath();

  browserInstance = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 720 },
    executablePath,
    headless: true,
  });

  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
      request.abort();
    } else {
      request.continue();
    }
  });

  return page;
}

export function serializeCookies(cookies: Cookie[]): string {
  return JSON.stringify(cookies);
}

export function deserializeCookies(cookiesStr: string): Cookie[] {
  return JSON.parse(cookiesStr);
}
