import type { BankAccountConfig } from '../types/pms';

export const VIETNAM_BANKS = [
  { id: 'MB', name: 'MB Bank (Quân Đội)' },
  { id: 'VCB', name: 'Vietcombank' },
  { id: 'TCB', name: 'Techcombank' },
  { id: 'BIDV', name: 'BIDV' },
  { id: 'ICB', name: 'VietinBank' },
  { id: 'ACB', name: 'ACB' },
  { id: 'VPB', name: 'VPBank' },
  { id: 'TPB', name: 'TPBank' },
  { id: 'STB', name: 'Sacombank' },
  { id: 'VIB', name: 'VIB' },
  { id: 'HDB', name: 'HDBank' },
  { id: 'AGR', name: 'Agribank' },
];

export function buildVietQrUrl(params: {
  bankAccount: BankAccountConfig;
  amount: number;
  addInfo: string;
}): string | null {
  const bankId = (params.bankAccount.bankId || import.meta.env.VITE_VIETQR_BANK_ID || 'MB').trim();
  const accountNo = (
    params.bankAccount.accountNo ||
    import.meta.env.VITE_VIETQR_ACCOUNT_NO ||
    ''
  ).trim();
  const accountName = (
    params.bankAccount.accountName ||
    import.meta.env.VITE_VIETQR_ACCOUNT_NAME ||
    'LE DUC PHUONG'
  ).trim();

  if (!bankId || !accountNo) return null;

  const cleanAmount = Math.max(0, Math.round(params.amount));
  const query = new URLSearchParams();
  if (cleanAmount > 0) query.set('amount', String(cleanAmount));
  if (params.addInfo.trim()) query.set('addInfo', params.addInfo.trim().slice(0, 50));
  if (accountName) query.set('accountName', accountName);

  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(
    accountNo
  )}-compact2.png?${query.toString()}`;
}
