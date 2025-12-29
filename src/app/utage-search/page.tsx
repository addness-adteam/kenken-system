"use client";

import { useState, useRef } from "react";

interface SearchResult {
  email: string;
  registrationRoute: string;
  funnelName: string;
  status: "pending" | "searching" | "found" | "not_found" | "error";
  error?: string;
}

interface LoginResponse {
  success: boolean;
  cookies?: string;
  error?: string;
}

interface SearchResponse {
  success: boolean;
  email?: string;
  registrationRoute?: string;
  funnelName?: string;
  sessionExpired?: boolean;
  error?: string;
}

export default function UtageSearchPage() {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!spreadsheetUrl) {
      setError("スプレッドシートURLを入力してください");
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setIsComplete(false);
    abortControllerRef.current = new AbortController();

    try {
      setStatus("スプレッドシートからデータを取得中...");
      const sheetResponse = await fetch("/api/utage/get-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheet_url: spreadsheetUrl }),
        signal: abortControllerRef.current.signal,
      });

      const sheetData = await sheetResponse.json();
      if (!sheetData.success) {
        throw new Error(sheetData.error || "スプレッドシートの取得に失敗しました");
      }

      const emails: string[] = sheetData.emails;
      if (emails.length === 0) {
        throw new Error("処理対象のメールアドレスがありません（登録経路が空の行がありません）");
      }

      const initialResults: SearchResult[] = emails.map((email) => ({
        email,
        registrationRoute: "",
        funnelName: "",
        status: "pending",
      }));
      setResults(initialResults);

      setStatus("UTAGEにログイン中...");
      const loginResponse = await fetch("/api/utage/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current.signal,
      });

      const loginData: LoginResponse = await loginResponse.json();
      if (!loginData.success || !loginData.cookies) {
        throw new Error(loginData.error || "UTAGEへのログインに失敗しました");
      }

      let cookies = loginData.cookies;

      for (let i = 0; i < emails.length; i++) {
        if (abortControllerRef.current?.signal.aborted) {
          break;
        }

        const email = emails[i];
        setStatus(`検索中 (${i + 1}/${emails.length}): ${email}`);

        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: "searching" } : r
          )
        );

        try {
          const searchResponse = await fetch("/api/utage/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, cookies }),
            signal: abortControllerRef.current.signal,
          });

          const searchData: SearchResponse = await searchResponse.json();

          if (searchData.sessionExpired) {
            setStatus("セッション切れ。再ログイン中...");
            const reloginResponse = await fetch("/api/utage/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: abortControllerRef.current.signal,
            });
            const reloginData: LoginResponse = await reloginResponse.json();
            if (!reloginData.success || !reloginData.cookies) {
              throw new Error("再ログインに失敗しました");
            }
            cookies = reloginData.cookies;

            const retryResponse = await fetch("/api/utage/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, cookies }),
              signal: abortControllerRef.current.signal,
            });
            const retryData: SearchResponse = await retryResponse.json();

            setResults((prev) =>
              prev.map((r, idx) =>
                idx === i
                  ? {
                      ...r,
                      registrationRoute: retryData.registrationRoute || "",
                      funnelName: retryData.funnelName || "",
                      status: retryData.registrationRoute ? "found" : "not_found",
                    }
                  : r
              )
            );
          } else if (searchData.success) {
            setResults((prev) =>
              prev.map((r, idx) =>
                idx === i
                  ? {
                      ...r,
                      registrationRoute: searchData.registrationRoute || "",
                      funnelName: searchData.funnelName || "",
                      status: searchData.registrationRoute ? "found" : "not_found",
                    }
                  : r
              )
            );
          } else {
            setResults((prev) =>
              prev.map((r, idx) =>
                idx === i
                  ? { ...r, status: "error", error: searchData.error }
                  : r
              )
            );
          }
        } catch (searchError) {
          if ((searchError as Error).name === "AbortError") {
            break;
          }
          setResults((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? { ...r, status: "error", error: String(searchError) }
                : r
            )
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!abortControllerRef.current?.signal.aborted) {
        setStatus("完了");
        setIsComplete(true);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "処理に失敗しました");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStatus("キャンセルされました");
      setLoading(false);
    }
  };

  const handleWriteToSheet = async () => {
    if (results.length === 0) return;

    setLoading(true);
    setStatus("スプレッドシートに書き込み中...");

    try {
      const response = await fetch("/api/utage/write-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheet_url: spreadsheetUrl,
          results: results.map((r) => ({
            email: r.email,
            registrationRoute: r.registrationRoute,
          })),
        }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "書き込みに失敗しました");
      }

      setStatus("スプレッドシートへの書き込みが完了しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "書き込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const foundCount = results.filter((r) => r.status === "found").length;
  const notFoundCount = results.filter((r) => r.status === "not_found").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const processedCount = foundCount + notFoundCount + errorCount;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            UTAGE自動検索
          </h1>
          <p className="text-gray-600">
            UTAGEの登録者一覧からメールアドレスに紐づく登録経路を自動検索します
          </p>
          <a
            href="/"
            className="inline-block mt-4 text-blue-600 hover:text-blue-800 underline"
          >
            トップページに戻る
          </a>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-xl p-8 space-y-6"
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              スプレッドシートURL
            </label>
            <input
              type="text"
              value={spreadsheetUrl}
              onChange={(e) => setSpreadsheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/xxxxx/edit"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ 「登録経路」または「UTAGE登録経路」列が空の行が処理対象になります
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              エラー: {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading}
              className={`flex-1 py-4 rounded-lg font-bold text-white text-lg transition ${
                loading
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-purple-600 hover:bg-purple-700 active:bg-purple-800"
              }`}
            >
              {loading ? "処理中..." : "検索開始"}
            </button>

            {loading && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-4 rounded-lg font-bold text-white text-lg bg-red-500 hover:bg-red-600 transition"
              >
                キャンセル
              </button>
            )}
          </div>
        </form>

        {status && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-4">
            <div className="flex items-center">
              {loading && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600 mr-3"></div>
              )}
              <span className="text-gray-700">{status}</span>
            </div>
            {results.length > 0 && (
              <div className="mt-3 bg-gray-100 rounded-lg p-3">
                <div className="flex gap-6 text-sm">
                  <span>
                    進捗: {processedCount}/{results.length}
                  </span>
                  <span className="text-green-600">成功: {foundCount}</span>
                  <span className="text-orange-600">未検出: {notFoundCount}</span>
                  {errorCount > 0 && (
                    <span className="text-red-600">エラー: {errorCount}</span>
                  )}
                </div>
                <div className="mt-2 w-full bg-gray-300 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all"
                    style={{
                      width: `${(processedCount / results.length) * 100}%`,
                    }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">検索結果</h2>
              {isComplete && (
                <button
                  onClick={handleWriteToSheet}
                  disabled={loading}
                  className={`px-6 py-2 rounded-lg font-bold text-white transition ${
                    loading
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  スプレッドシートに書き込む
                </button>
              )}
            </div>

            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left">#</th>
                    <th className="px-4 py-2 text-left">メールアドレス</th>
                    <th className="px-4 py-2 text-left">登録経路</th>
                    <th className="px-4 py-2 text-left">ファネル</th>
                    <th className="px-4 py-2 text-left">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, index) => (
                    <tr
                      key={index}
                      className={`border-t ${
                        result.status === "searching" ? "bg-yellow-50" : ""
                      }`}
                    >
                      <td className="px-4 py-2">{index + 1}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {result.email}
                      </td>
                      <td className="px-4 py-2">{result.registrationRoute}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {result.funnelName}
                      </td>
                      <td className="px-4 py-2">
                        {result.status === "pending" && (
                          <span className="text-gray-400">待機中</span>
                        )}
                        {result.status === "searching" && (
                          <span className="text-yellow-600">検索中...</span>
                        )}
                        {result.status === "found" && (
                          <span className="text-green-600">検出</span>
                        )}
                        {result.status === "not_found" && (
                          <span className="text-orange-600">未検出</span>
                        )}
                        {result.status === "error" && (
                          <span className="text-red-600" title={result.error}>
                            エラー
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
