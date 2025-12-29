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

function colIndexToLetter(index: number): string {
  let result = '';
  let idx = index + 1;
  while (idx > 0) {
    const remainder = (idx - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    idx = Math.floor((idx - 1) / 26);
  }
  return result;
}

function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.trim().normalize('NFKC').toLowerCase();
}

interface WriteResult {
  email: string;
  registrationRoute: string;
}

interface WriteResultsResponse {
  success: boolean;
  updatedCount?: number;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WriteResultsResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { spreadsheet_url, results } = req.body as {
      spreadsheet_url: string;
      results: WriteResult[];
    };

    if (!spreadsheet_url || !results) {
      return res.status(400).json({
        success: false,
        error: 'スプレッドシートURLと結果データが必要です',
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
    const isNewColumn = routeColIndex < 0;
    if (isNewColumn) {
      routeColIndex = headerRow.length;
    }

    const resultMap: Record<string, string> = {};
    for (const r of results) {
      const normalized = normalizeEmail(r.email);
      if (r.registrationRoute) {
        resultMap[normalized] = r.registrationRoute;
      }
    }

    const valuesToWrite: string[][] = [];

    if (isNewColumn) {
      valuesToWrite.push(['UTAGE登録経路']);
    } else {
      const existingHeader = allData[0][routeColIndex] || '登録経路';
      valuesToWrite.push([existingHeader]);
    }

    let updatedCount = 0;
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i] || [];
      const email = row[emailColIndex] ? String(row[emailColIndex]).trim() : '';
      const existingRoute = row[routeColIndex] ? String(row[routeColIndex]).trim() : '';

      if (email && !existingRoute) {
        const normalized = normalizeEmail(email);
        const newRoute = resultMap[normalized] || '';
        valuesToWrite.push([newRoute]);
        if (newRoute) {
          updatedCount++;
        }
      } else {
        valuesToWrite.push([existingRoute]);
      }
    }

    const routeColLetter = colIndexToLetter(routeColIndex);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${routeColLetter}1:${routeColLetter}${valuesToWrite.length}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: valuesToWrite,
      },
    });

    return res.status(200).json({
      success: true,
      updatedCount,
    });
  } catch (error) {
    console.error('Write results error:', error);
    return res.status(500).json({
      success: false,
      error: String(error),
    });
  }
}
