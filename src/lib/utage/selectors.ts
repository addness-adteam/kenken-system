export const SELECTORS = {
  // ログインページ
  login: {
    emailInput: 'input[name="email"]',
    passwordInput: 'input[name="password"]',
    submitButton: 'button[type="submit"]',
    operatorLoginCheck: 'h1, .login-title',
  },

  // 登録者一覧ページ
  subscriber: {
    table: 'table',
    tableBody: 'tbody',
    tableRow: 'tr',
    registrationRouteCell: 'td:nth-child(4)',
    noDataMessage: '.no-data, .empty-message',
  },
};
