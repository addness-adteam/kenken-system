import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import Papa from "papaparse";

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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const spreadsheetUrl = formData.get("spreadsheet_url") as string;
    const csvFile = formData.get("csv_file") as File;

    if (!spreadsheetUrl || !csvFile) {
      return NextResponse.json(
        { success: false, error: "スプレッドシートURLとCSVファイルが必要です" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { success: false, error: "スプレッドシートにデータがありません" },
        { status: 400 }
      );
    }

    // メールアドレス列を検出
    const headerRow = allData[0] as string[];
    const emailColIndex = findEmailColumn(headerRow);
    if (emailColIndex < 0) {
      return NextResponse.json(
        { success: false, error: "メールアドレス列が見つかりません" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { success: false, error: "メールアドレスが見つかりません" },
        { status: 400 }
      );
    }

    // CSVを読み込み
    const csvText = await csvFile.text();
    const parseResult = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const csvData = parseResult.data as Record<string, string>[];

    // 必須カラムチェック
    if (csvData.length === 0) {
      return NextResponse.json(
        { success: false, error: "CSVにデータがありません" },
        { status: 400 }
      );
    }

    const firstRow = csvData[0];
    if (!(UTAGE_EMAIL_COLUMN in firstRow)) {
      return NextResponse.json(
        { success: false, error: `CSVに「${UTAGE_EMAIL_COLUMN}」列がありません` },
        { status: 400 }
      );
    }
    if (!(UTAGE_ROUTE_COLUMN in firstRow)) {
      return NextResponse.json(
        { success: false, error: `CSVに「${UTAGE_ROUTE_COLUMN}」列がありません` },
        { status: 400 }
      );
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

    return NextResponse.json({
      success: true,
      total_count: emails.length,
      success_count: emails.length - notFoundEmails.length,
      not_found_count: notFoundEmails.length,
      not_found_emails: notFoundEmails.slice(0, 50),
    });

  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
