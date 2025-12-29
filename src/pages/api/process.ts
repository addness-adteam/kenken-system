import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import formidable from "formidable";
import fs from "fs";
import Papa from "papaparse";

// body parserを無効化（formidableを使用）
export const config = {
  api: {
    bodyParser: false,
  },
};

// 設定
const EMAIL_COLUMN_PATTERNS = ["メールアドレス", "メアド", "eメール", "email", "e-mail", "mail"];
const UTAGE_EMAIL_COLUMN = "メールアドレス";
const UTAGE_ROUTE_COLUMN = "登録経路";

function getCredentials() {
  const credsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credsJson) {
    throw new Error("GOOGLE_CREDENTIALS環境変数が設定されていません");
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

function normalizeEmail(email: string): string {
  if (!email) return "";
  return email.trim().normalize("NFKC").toLowerCase();
}

function findEmailColumn(headerRow: string[]): number {
  for (let i = 0; i < headerRow.length; i++) {
    const colLower = String(headerRow[i]).toLowerCase().trim();
    for (const pattern of EMAIL_COLUMN_PATTERNS) {
      if (colLower.includes(pattern.toLowerCase()) || pattern.toLowerCase().includes(colLower)) {
        return i;
      }
    }
  }
  return -1;
}

function colIndexToLetter(index: number): string {
  let result = "";
  let idx = index + 1;
  while (idx > 0) {
    const remainder = (idx - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    idx = Math.floor((idx - 1) / 26);
  }
  return result;
}

interface FormFields {
  spreadsheet_url?: string | string[];
}

interface FormFiles {
  csv_file?: formidable.File | formidable.File[];
}

async function parseForm(req: NextApiRequest): Promise<{ fields: FormFields; files: FormFiles }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields: fields as FormFields, files: files as FormFiles });
    });
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { fields, files } = await parseForm(req);

    const spreadsheetUrl = Array.isArray(fields.spreadsheet_url)
      ? fields.spreadsheet_url[0]
      : fields.spreadsheet_url;

    const csvFileField = files.csv_file;
    const csvFile = Array.isArray(csvFileField) ? csvFileField[0] : csvFileField;

    if (!spreadsheetUrl || !csvFile) {
      return res.status(400).json({
        success: false,
        error: "スプレッドシートURLとCSVファイルが必要です",
      });
    }

    // スプレッドシートID抽出
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);

    // Google認証
    const credentials = getCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // スプレッドシートデータ取得
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "A:ZZ",
    });

    const allData = response.data.values;
    if (!allData || allData.length === 0) {
      return res.status(400).json({
        success: false,
        error: "スプレッドシートにデータがありません",
      });
    }

    // メールアドレス列を検出
    const headerRow = allData[0] as string[];
    const emailColIndex = findEmailColumn(headerRow);
    if (emailColIndex < 0) {
      return res.status(400).json({
        success: false,
        error: "メールアドレス列が見つかりません",
      });
    }

    // メールアドレスを抽出
    const emails: string[] = [];
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      if (row && emailColIndex < row.length && row[emailColIndex]) {
        emails.push(row[emailColIndex]);
      }
    }

    if (emails.length === 0) {
      return res.status(400).json({
        success: false,
        error: "メールアドレスが見つかりません",
      });
    }

    // CSVを読み込み
    const csvContent = fs.readFileSync(csvFile.filepath, "utf-8");
    const parseResult = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    const csvData = parseResult.data as Record<string, string>[];

    // 必須カラムチェック
    if (csvData.length === 0) {
      return res.status(400).json({
        success: false,
        error: "CSVにデータがありません",
      });
    }

    const firstRow = csvData[0];
    if (!(UTAGE_EMAIL_COLUMN in firstRow)) {
      return res.status(400).json({
        success: false,
        error: `CSVに「${UTAGE_EMAIL_COLUMN}」列がありません`,
      });
    }
    if (!(UTAGE_ROUTE_COLUMN in firstRow)) {
      return res.status(400).json({
        success: false,
        error: `CSVに「${UTAGE_ROUTE_COLUMN}」列がありません`,
      });
    }

    // インデックス作成
    const emailToRoutes: Record<string, string[]> = {};
    for (const row of csvData) {
      const email = String(row[UTAGE_EMAIL_COLUMN] || "");
      const route = String(row[UTAGE_ROUTE_COLUMN] || "");
      if (!email) continue;

      const normalized = normalizeEmail(email);
      if (!emailToRoutes[normalized]) {
        emailToRoutes[normalized] = [];
      }
      if (route && !emailToRoutes[normalized].includes(route)) {
        emailToRoutes[normalized].push(route);
      }
    }

    // 照合
    const results: { email: string; routes: string[]; found: boolean }[] = [];
    const notFoundEmails: string[] = [];

    for (const email of emails) {
      const normalized = normalizeEmail(email);
      const routes = emailToRoutes[normalized] || [];
      if (routes.length > 0) {
        results.push({ email, routes, found: true });
      } else {
        results.push({ email, routes: [], found: false });
        notFoundEmails.push(email);
      }
    }

    // UTAGE登録経路列の位置を決定
    let routeColIndex = headerRow.length;
    for (let i = 0; i < headerRow.length; i++) {
      if (headerRow[i] === "UTAGE登録経路") {
        routeColIndex = i;
        break;
      }
    }

    const routeColLetter = colIndexToLetter(routeColIndex);

    // 結果マッピング
    const resultMap: Record<string, string> = {};
    for (const r of results) {
      const normalized = normalizeEmail(r.email);
      resultMap[normalized] = r.routes.join(", ");
    }

    // データ準備
    const valuesToWrite: string[][] = [["UTAGE登録経路"]];
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      if (row && emailColIndex < row.length) {
        const email = row[emailColIndex];
        const normalized = normalizeEmail(email);
        const route = resultMap[normalized] || "";
        valuesToWrite.push([route]);
      } else {
        valuesToWrite.push([""]);
      }
    }

    // スプレッドシートに書き込み
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${routeColLetter}1:${routeColLetter}${valuesToWrite.length}`,
      valueInputOption: "RAW",
      requestBody: {
        values: valuesToWrite,
      },
    });

    // 一時ファイル削除
    fs.unlinkSync(csvFile.filepath);

    return res.status(200).json({
      success: true,
      total_count: emails.length,
      success_count: emails.length - notFoundEmails.length,
      not_found_count: notFoundEmails.length,
      not_found_emails: notFoundEmails.slice(0, 50),
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      success: false,
      error: String(error),
    });
  }
}
