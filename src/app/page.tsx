"use client";

import { useState } from "react";
import Link from "next/link";
import Papa from "papaparse";

interface ProcessResult {
  success: boolean;
  total_count: number;
  success_count: number;
  not_found_count: number;
  not_found_emails: string[];
  error?: string;
}

interface CsvRow {
  [key: string]: string;
}

type Mode = "select" | "csv";

export default function Home() {
  const [mode, setMode] = useState<Mode>("select");
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!spreadsheetUrl || !csvFile) {
      setError("スプレッドシートURLとCSVファイルを入力してください");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setLoadingMessage("CSVファイルを解析中...");

    try {
      // CSVをブラウザ側で解析（BOMを除去）
      let csvText = await csvFile.text();
      // BOM (Byte Order Mark) を除去
      if (csvText.charCodeAt(0) === 0xfeff) {
        csvText = csvText.slice(1);
      }

      const parseResult = Papa.parse<CsvRow>(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      if (parseResult.errors.length > 0) {
        throw new Error("CSVファイルの解析に失敗しました");
      }

      const csvData = parseResult.data;

      // メールアドレス列と登録経路列を確認
      if (csvData.length === 0) {
        throw new Error("CSVにデータがありません");
      }

      // カラム名を柔軟に検索する関数
      const findColumnName = (row: CsvRow, patterns: string[]): string | null => {
        const keys = Object.keys(row);
        for (const key of keys) {
          const keyLower = key.toLowerCase().trim();
          for (const pattern of patterns) {
            if (keyLower.includes(pattern.toLowerCase())) {
              return key;
            }
          }
        }
        return null;
      };

      const firstRow = csvData[0];
      const emailPatterns = ["メールアドレス", "メアド", "eメール", "email", "e-mail", "mail"];
      const routePatterns = ["登録経路"];

      const emailColumn = findColumnName(firstRow, emailPatterns);
      if (!emailColumn) {
        throw new Error("CSVに「メールアドレス」列がありません");
      }

      const routeColumn = findColumnName(firstRow, routePatterns);
      if (!routeColumn) {
        throw new Error("CSVに「登録経路」列がありません");
      }

      // メールアドレスと登録経路のマッピングを作成
      setLoadingMessage("データを抽出中...");
      const emailRouteMap: Record<string, string[]> = {};

      for (const row of csvData) {
        const email = String(row[emailColumn] || "").trim().toLowerCase();
        const route = String(row[routeColumn] || "");

        if (!email) continue;

        if (!emailRouteMap[email]) {
          emailRouteMap[email] = [];
        }
        if (route && !emailRouteMap[email].includes(route)) {
          emailRouteMap[email].push(route);
        }
      }

      setLoadingMessage("サーバーに送信中...");

      // JSONでサーバーに送信（ファイルより遥かに小さい）
      const response = await fetch("/api/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spreadsheet_url: spreadsheetUrl,
          email_route_map: emailRouteMap,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || "処理中にエラーが発生しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "処理に失敗しました");
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  };

  if (mode === "select") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              UTAGE登録経路取得システム
            </h1>
            <p className="text-gray-600">
              登録経路の取得方法を選択してください
            </p>
          </div>

          <div className="grid gap-6">
            <button
              onClick={() => setMode("csv")}
              className="bg-white rounded-2xl shadow-xl p-8 text-left hover:shadow-2xl transition-shadow border-2 border-transparent hover:border-blue-400"
            >
              <div className="flex items-start gap-4">
                <div className="text-4xl">📁</div>
                <div>
                  <h2 className="text-xl font-bold text-gray-800 mb-2">
                    CSV解析で登録経路を取得
                  </h2>
                  <p className="text-gray-600 text-sm">
                    UTAGEからダウンロードした売上一覧CSVファイルを使用して、
                    メールアドレスに紐づく登録経路を取得します。
                    高速で安定した処理が可能です。
                  </p>
                  <p className="text-blue-600 text-sm mt-2 font-medium">
                    おすすめ: 大量データの処理向け
                  </p>
                </div>
              </div>
            </button>

            <Link
              href="/utage-search"
              className="bg-white rounded-2xl shadow-xl p-8 text-left hover:shadow-2xl transition-shadow border-2 border-transparent hover:border-purple-400 block"
            >
              <div className="flex items-start gap-4">
                <div className="text-4xl">🔍</div>
                <div>
                  <h2 className="text-xl font-bold text-gray-800 mb-2">
                    UTAGE自動検索で登録経路を取得
                  </h2>
                  <p className="text-gray-600 text-sm">
                    UTAGEの登録者一覧を自動検索して登録経路を取得します。
                    CSVダウンロード不要で、直接検索を行います。
                  </p>
                  <p className="text-purple-600 text-sm mt-2 font-medium">
                    CSVダウンロードが面倒な場合はこちら
                  </p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            CSV解析で登録経路を取得
          </h1>
          <p className="text-gray-600">
            UTAGEの売上一覧CSVからメールアドレスに紐づく登録経路を取得し、
            Googleスプレッドシートに書き込みます
          </p>
          <button
            onClick={() => {
              setMode("select");
              setResult(null);
              setError(null);
            }}
            className="mt-4 text-blue-600 hover:text-blue-800 underline"
          >
            機能選択に戻る
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              1. スプレッドシートURL
            </label>
            <input
              type="text"
              value={spreadsheetUrl}
              onChange={(e) => setSpreadsheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/xxxxx/edit"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ スプレッドシートはサービスアカウントと共有されている必要があります
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              2. UTAGE売上CSVファイル
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition cursor-pointer">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="hidden"
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="cursor-pointer">
                {csvFile ? (
                  <div className="text-green-600">
                    <p className="text-2xl">✓</p>
                    <p className="mt-2 font-medium">{csvFile.name}</p>
                    <p className="text-sm text-gray-500">クリックして変更</p>
                  </div>
                ) : (
                  <div className="text-gray-500">
                    <p className="text-4xl">📁</p>
                    <p className="mt-2">クリックしてCSVファイルを選択</p>
                  </div>
                )}
              </label>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              エラー: {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-4 rounded-lg font-bold text-white text-lg transition ${
              loading
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
            }`}
          >
            {loading ? loadingMessage || "処理中..." : "実行"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">処理結果</h2>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-blue-600">{result.total_count}</p>
                <p className="text-sm text-gray-600">処理件数</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-green-600">{result.success_count}</p>
                <p className="text-sm text-gray-600">成功</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-orange-600">{result.not_found_count}</p>
                <p className="text-sm text-gray-600">未検出</p>
              </div>
            </div>

            {result.not_found_emails.length > 0 && (
              <details className="bg-orange-50 rounded-lg p-4">
                <summary className="cursor-pointer font-medium text-orange-800">
                  未検出メールアドレス一覧 ({result.not_found_count}件)
                </summary>
                <ul className="mt-3 space-y-1 text-sm text-gray-700 max-h-48 overflow-y-auto">
                  {result.not_found_emails.map((email, i) => (
                    <li key={i}>・ {email}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-6 p-4 bg-green-50 rounded-lg text-center">
              <p className="text-green-700 font-medium">
                スプレッドシートに「UTAGE登録経路」列を追加しました
              </p>
            </div>
          </div>
        )}

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            スプレッドシートは以下のメールアドレスと「編集者」権限で共有してください:
          </p>
          <code className="block mt-1 text-xs bg-gray-100 px-3 py-1 rounded">
            utage-sheet-automation@utageautomation.iam.gserviceaccount.com
          </code>
        </div>
      </div>
    </div>
  );
}
