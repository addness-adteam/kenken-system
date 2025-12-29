"""
UTAGE登録経路取得API - Vercel Serverless Function
"""

import json
import os
import re
import tempfile
import unicodedata
from http.server import BaseHTTPRequestHandler

import gspread
import pandas as pd
from google.oauth2 import service_account


# 設定
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
EMAIL_COLUMN_PATTERNS = ["メールアドレス", "メアド", "eメール", "email", "e-mail", "mail"]
UTAGE_EMAIL_COLUMN = "メールアドレス"
UTAGE_ROUTE_COLUMN = "登録経路"


def get_credentials():
    """環境変数からGoogle認証情報を取得"""
    creds_json = os.environ.get("GOOGLE_CREDENTIALS")
    if not creds_json:
        raise Exception("GOOGLE_CREDENTIALS環境変数が設定されていません")

    creds_info = json.loads(creds_json)
    return service_account.Credentials.from_service_account_info(creds_info, scopes=SCOPES)


def extract_spreadsheet_id(url_or_id: str) -> str:
    """スプレッドシートURLからIDを抽出"""
    patterns = [
        r"https://docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]+)",
        r"^([a-zA-Z0-9_-]+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    return url_or_id


def normalize_email(email: str) -> str:
    """メールアドレスを正規化"""
    if not email:
        return ""
    result = email.strip()
    result = unicodedata.normalize("NFKC", result)
    result = result.lower()
    return result


def find_email_column(header_row: list) -> int:
    """ヘッダー行からメールアドレス列を検出"""
    for i, col_name in enumerate(header_row):
        col_lower = str(col_name).lower().strip()
        for pattern in EMAIL_COLUMN_PATTERNS:
            if pattern.lower() in col_lower or col_lower in pattern.lower():
                return i
    return -1


def col_index_to_letter(index: int) -> str:
    """列インデックスをアルファベットに変換"""
    result = ""
    index += 1
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def process_data(spreadsheet_url: str, csv_content: bytes) -> dict:
    """メイン処理"""
    # スプレッドシートID抽出
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url)

    # Google認証
    credentials = get_credentials()
    client = gspread.authorize(credentials)

    # スプレッドシートを開く
    spreadsheet = client.open_by_key(spreadsheet_id)
    worksheet = spreadsheet.sheet1

    # 全データ取得
    all_data = worksheet.get_all_values()
    if not all_data:
        raise Exception("スプレッドシートにデータがありません")

    # メールアドレス列を検出
    header_row = all_data[0]
    email_col_index = find_email_column(header_row)
    if email_col_index < 0:
        raise Exception("メールアドレス列が見つかりません")

    # メールアドレスを抽出
    emails = []
    for row in all_data[1:]:
        if email_col_index < len(row) and row[email_col_index]:
            emails.append(row[email_col_index])

    if not emails:
        raise Exception("メールアドレスが見つかりません")

    # CSVを読み込み
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        tmp.write(csv_content)
        tmp_path = tmp.name

    try:
        # エンコーディング判定
        try:
            csv_data = pd.read_csv(tmp_path, encoding="utf-8")
        except UnicodeDecodeError:
            csv_data = pd.read_csv(tmp_path, encoding="cp932")

        # 必須カラムチェック
        if UTAGE_EMAIL_COLUMN not in csv_data.columns:
            raise Exception(f"CSVに「{UTAGE_EMAIL_COLUMN}」列がありません")
        if UTAGE_ROUTE_COLUMN not in csv_data.columns:
            raise Exception(f"CSVに「{UTAGE_ROUTE_COLUMN}」列がありません")

        # インデックス作成
        email_to_routes = {}
        for _, row in csv_data.iterrows():
            email = str(row.get(UTAGE_EMAIL_COLUMN, ""))
            route = str(row.get(UTAGE_ROUTE_COLUMN, ""))
            if not email:
                continue
            normalized = normalize_email(email)
            if normalized not in email_to_routes:
                email_to_routes[normalized] = []
            if route not in email_to_routes[normalized]:
                email_to_routes[normalized].append(route)

        # 照合
        results = []
        not_found_emails = []
        for email in emails:
            normalized = normalize_email(email)
            routes = email_to_routes.get(normalized, [])
            if routes:
                results.append({"email": email, "routes": routes, "found": True})
            else:
                results.append({"email": email, "routes": [], "found": False})
                not_found_emails.append(email)

        # スプレッドシートに書き込み
        # UTAGE登録経路列の位置を決定
        existing_route_col = None
        for i, col_name in enumerate(header_row):
            if col_name == "UTAGE登録経路":
                existing_route_col = i
                break

        if existing_route_col is not None:
            route_col_index = existing_route_col
        else:
            route_col_index = len(header_row)

        route_col_letter = col_index_to_letter(route_col_index)

        # ヘッダー書き込み
        worksheet.update(f"{route_col_letter}1", [["UTAGE登録経路"]])

        # 結果マッピング
        result_map = {}
        for r in results:
            normalized = normalize_email(r["email"])
            result_map[normalized] = ", ".join(r["routes"])

        # データ書き込み
        values_to_write = []
        for row in all_data[1:]:
            if email_col_index < len(row):
                email = row[email_col_index]
                normalized = normalize_email(email)
                route = result_map.get(normalized, "")
                values_to_write.append([route])
            else:
                values_to_write.append([""])

        if values_to_write:
            cell_range = f"{route_col_letter}2:{route_col_letter}{len(values_to_write) + 1}"
            worksheet.update(cell_range, values_to_write)

        return {
            "success": True,
            "total_count": len(emails),
            "success_count": len(emails) - len(not_found_emails),
            "not_found_count": len(not_found_emails),
            "not_found_emails": not_found_emails[:50],  # 最大50件
        }

    finally:
        os.unlink(tmp_path)


class handler(BaseHTTPRequestHandler):
    def send_cors_headers(self):
        """CORSヘッダーを送信"""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        """プリフライトリクエスト対応"""
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        try:
            # Content-Typeからboundaryを取得
            content_type = self.headers.get("Content-Type", "")

            # Content-Lengthを取得
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            # multipart/form-dataをパース
            if "multipart/form-data" in content_type:
                boundary = content_type.split("boundary=")[1].encode()
                parts = body.split(b"--" + boundary)

                spreadsheet_url = None
                csv_content = None

                for part in parts:
                    if b'name="spreadsheet_url"' in part:
                        # テキストフィールド
                        lines = part.split(b"\r\n\r\n", 1)
                        if len(lines) > 1:
                            spreadsheet_url = lines[1].rstrip(b"\r\n--").decode("utf-8")
                    elif b'name="csv_file"' in part:
                        # ファイルフィールド
                        lines = part.split(b"\r\n\r\n", 1)
                        if len(lines) > 1:
                            csv_content = lines[1].rstrip(b"\r\n--")

                if not spreadsheet_url or not csv_content:
                    raise Exception("スプレッドシートURLとCSVファイルが必要です")

                result = process_data(spreadsheet_url, csv_content)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
            else:
                raise Exception("multipart/form-dataが必要です")

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": False,
                "error": str(e)
            }).encode())
