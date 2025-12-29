import type { NextApiRequest, NextApiResponse } from 'next';
import { getBrowser, createPage, closeBrowser, serializeCookies } from '@/lib/utage/browser';
import { UTAGE_LOGIN_URL } from '@/lib/utage/funnels';
import { SELECTORS } from '@/lib/utage/selectors';

interface LoginResponse {
  success: boolean;
  cookies?: string;
  error?: string;
  errorCode?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LoginResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let browser = null;
  let page = null;

  try {
    const email = process.env.UTAGE_EMAIL;
    const password = process.env.UTAGE_PASSWORD;

    if (!email || !password) {
      return res.status(500).json({
        success: false,
        error: 'UTAGE認証情報が設定されていません',
        errorCode: 'E401',
      });
    }

    browser = await getBrowser();
    page = await createPage(browser);

    await page.goto(UTAGE_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    const currentUrl = page.url();
    if (!currentUrl.includes('/operator/')) {
      await page.goto(UTAGE_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    }

    const pageTitle = await page.title();
    const pageContent = await page.content();
    if (pageContent.includes('CAPTCHA') || pageContent.includes('captcha')) {
      return res.status(400).json({
        success: false,
        error: 'CAPTCHAが表示されています。手動でログインしてください。',
        errorCode: 'E404',
      });
    }

    await page.waitForSelector(SELECTORS.login.emailInput, { timeout: 10000 });
    await page.type(SELECTORS.login.emailInput, email);
    await page.type(SELECTORS.login.passwordInput, password);

    await Promise.all([
      page.click(SELECTORS.login.submitButton),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    ]);

    const afterLoginUrl = page.url();
    if (afterLoginUrl.includes('/login')) {
      return res.status(401).json({
        success: false,
        error: 'ログインに失敗しました。認証情報を確認してください。',
        errorCode: 'E401',
      });
    }

    const cookies = await page.cookies();
    const serializedCookies = serializeCookies(cookies);

    await page.close();

    return res.status(200).json({
      success: true,
      cookies: serializedCookies,
    });
  } catch (error) {
    console.error('Login error:', error);

    if (page) {
      try {
        await page.close();
      } catch {}
    }

    return res.status(500).json({
      success: false,
      error: `ログイン処理中にエラーが発生しました: ${String(error)}`,
      errorCode: 'E401',
    });
  }
}
