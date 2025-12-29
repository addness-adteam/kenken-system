import type { NextApiRequest, NextApiResponse } from 'next';
import { getBrowser, createPage, deserializeCookies } from '@/lib/utage/browser';
import { FUNNELS, getSubscriberSearchUrl, UTAGE_LOGIN_URL } from '@/lib/utage/funnels';

interface SearchResponse {
  success: boolean;
  email?: string;
  registrationRoute?: string;
  funnelName?: string;
  sessionExpired?: boolean;
  error?: string;
  errorCode?: string;
}

interface SearchRequest {
  email: string;
  cookies: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SearchResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let page = null;

  try {
    const { email, cookies } = req.body as SearchRequest;

    if (!email || !cookies) {
      return res.status(400).json({
        success: false,
        error: 'メールアドレスとセッション情報が必要です',
      });
    }

    const browser = await getBrowser();
    page = await createPage(browser);

    const cookieObjects = deserializeCookies(cookies);
    await page.setCookie(...cookieObjects);

    for (const funnel of FUNNELS) {
      const searchUrl = getSubscriberSearchUrl(funnel.id, email);

      try {
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      } catch (navError) {
        console.error(`Navigation error for funnel ${funnel.name}:`, navError);
        continue;
      }

      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        await page.close();
        return res.status(401).json({
          success: false,
          sessionExpired: true,
          error: 'セッションが期限切れです。再ログインが必要です。',
          errorCode: 'E402',
        });
      }

      try {
        await page.waitForSelector('table', { timeout: 5000 });
      } catch {
        continue;
      }

      const registrationRoute = await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table) return null;

        const rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) return null;

        const firstRow = rows[0];
        const cells = firstRow.querySelectorAll('td');

        for (let i = 0; i < cells.length; i++) {
          const headerCells = table.querySelectorAll('thead th');
          if (headerCells[i]?.textContent?.includes('登録経路')) {
            return cells[i]?.textContent?.trim() || null;
          }
        }

        if (cells.length >= 4) {
          return cells[3]?.textContent?.trim() || null;
        }

        return null;
      });

      if (registrationRoute) {
        await page.close();
        return res.status(200).json({
          success: true,
          email,
          registrationRoute,
          funnelName: funnel.name,
        });
      }
    }

    await page.close();

    return res.status(200).json({
      success: true,
      email,
      registrationRoute: '',
      funnelName: '',
    });
  } catch (error) {
    console.error('Search error:', error);

    if (page) {
      try {
        await page.close();
      } catch {}
    }

    return res.status(500).json({
      success: false,
      error: `検索処理中にエラーが発生しました: ${String(error)}`,
      errorCode: 'E601',
    });
  }
}
