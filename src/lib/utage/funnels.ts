export interface Funnel {
  name: string;
  id: string;
}

export const FUNNELS: Funnel[] = [
  { name: 'SNS：メインファネル_Meta広告', id: 'IyarhS8EGCgK' },
  { name: 'AI：メインファネル_Meta広告', id: 'TXUOxBYkYr9e' },
  { name: 'SNS：メインファネル_TikTok広告', id: 'dZNDzwCgHNBC' },
  { name: 'AI：メインファネル_TikTok広告', id: 'a09j9jop95LF' },
  { name: 'SNS：メインファネル_YouTube広告', id: 'cf2x3vhACyzZ' },
  { name: 'AI：メインファネル_YouTube広告', id: 'swWWfVKFd1ph' },
];

export const UTAGE_BASE_URL = 'https://school.addness.co.jp';
export const UTAGE_LOGIN_URL = `${UTAGE_BASE_URL}/operator/GYbKT7Y9d0eR/login`;

export function getSubscriberSearchUrl(funnelId: string, email: string): string {
  return `${UTAGE_BASE_URL}/subscriber/${funnelId}?mail=${encodeURIComponent(email)}`;
}
