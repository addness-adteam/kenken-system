import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';

const EMAIL_COLUMN_PATTERNS = ['メールアドレス', 'メアド', 'eメール', 'email', 'e-mail', 'mail'];
const ROUTE_COLUMN_PATTERNS = ['登録経路', 'UTAGE登録経路'];

function getCredentials() {
  const credsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credsJson) {
    throw new Error('GOOGLE_CREDENTIALS環境変数が設定されていません');
  }
  return JSON.parse(credsJson);
}

function extractSpreadsheetId(urlOrId: string): string {
  const patterns = [
    /https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /^([a-zA-Z0-9_-]+)$/,
  ];
  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return urlOrId;
}

function findColumn(headerRow: string[], patterns: string[]): number {
  for (let i = 0; i < headerRow.length; i++) {
    const colLower = String(headerRow[i]).toLowerCase().trim();
    for (const pattern of patterns) {
      if (colLower.includes(pattern.toLowerCase()) || pattern.toLowerCase().includes(colLower)) {
        return i;
      }
    }
  }
  return -1;
}

interface GetEmailsResponse {
  success: boolean;
  emails?: string[];
  emailColumnIndex?: number;
  routeColumnIndex?: number;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetEmailsResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { spreadsheet_url } = req.body;

    if (!spreadsheet_url) {
      return res.status(400).json({
        success: false,
        error: 'スプレッドシートURLが必要です',
      });
    }

    const spreadsheetId = extractSpreadsheetId(spreadsheet_url);

    const credentials = getCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A:ZZ',
    });

    const allData = response.data.values;
    if (!allData || allData.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'スプレッドシートにデータがありません',
      });
    }

    const headerRow = allData[0] as string[];
    const emailColIndex = findColumn(headerRow, EMAIL_COLUMN_PATTERNS);
    if (emailColIndex < 0) {
      return res.status(400).json({
        success: false,
        error: 'メールアドレス列が見つかりません',
      });
    }

    let routeColIndex = findColumn(headerRow, ROUTE_COLUMN_PATTERNS);
    if (routeColIndex < 0) {
      routeColIndex = headerRow.length;
    }

    const emails: string[] = [];
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i] || [];
      const email = row[emailColIndex] ? String(row[emailColIndex]).trim() : '';
      const route = row[routeColIndex] ? String(row[routeColIndex]).trim() : '';

      if (email && !route) {
        emails.push(email);
      }
    }

    return res.status(200).json({
      success: true,
      emails,
      emailColumnIndex: emailColIndex,
      routeColumnIndex: routeColIndex,
    });
  } catch (error) {
    console.error('Get emails error:', error);
    return res.status(500).json({
      success: false,
      error: String(error),
    });
  }
}
