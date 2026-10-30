import crypto from "node:crypto";
import { BakongKHQR, IndividualInfo, khqrData } from "bakong-khqr";

export type PaymentMethod = "BAKONG";

export interface InitiatePaymentArgs {
  orderNumber: string;
  amountUsd: number;
  method: PaymentMethod;
  note?: string;
}

export interface PaymentInitResult {
  paymentRef: string; // MD5 of the generated KHQR payload
  qrString: string;
  expiresAt: Date;
}

const token = () => process.env.BAKONG_API_TOKEN?.trim();
const baseUrl = () => (process.env.BAKONG_API_BASE_URL || "https://api-bakong.nbc.gov.kh").replace(/\/$/, "");

export function generateBakongPayment(args: InitiatePaymentArgs): PaymentInitResult {
  if (args.method !== "BAKONG") throw new Error("Unsupported payment method");
  if (!token()) throw new Error("BAKONG_API_TOKEN is not configured");
  const accountId = process.env.BAKONG_ACCOUNT_ID?.trim();
  const merchantName = (process.env.BAKONG_MERCHANT_NAME || "TRATOPUP").trim();
  const merchantCity = (process.env.MERCHANT_CITY || "Tboung Khmum").trim();
  if (!accountId) throw new Error("BAKONG_ACCOUNT_ID is not configured");
  if (!Number.isFinite(args.amountUsd) || args.amountUsd <= 0) throw new Error("Invalid USD amount");

  const optionalData = {
    currency: khqrData.currency.usd,
    amount: Number(args.amountUsd.toFixed(2)),
    billNumber: args.orderNumber,
    storeLabel: "TRATOPUP",
    terminalLabel: "ONLINE",
    expirationTimestamp: Date.now() + 10 * 60 * 1000,
  };
  const individualInfo = new IndividualInfo(
    accountId,
    khqrData.currency.usd,
    merchantName,
    merchantCity,
    optionalData
  );
  const result: any = new BakongKHQR().generateIndividual(individualInfo);
  const qrString = result?.data?.qr;
  const md5 = result?.data?.md5 || (qrString ? crypto.createHash("md5").update(qrString).digest("hex") : null);
  if (result?.status?.code !== 0 || !qrString || !md5) {
    throw new Error(result?.status?.message || "Bakong KHQR generation failed");
  }
  return {
    paymentRef: String(md5),
    qrString: String(qrString),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  };
}

export interface BakongTransaction {
  hash: string;
  fromAccountId: string;
  toAccountId: string;
  currency: string;
  amount: number | string;
  description?: string;
  createdDateMs?: number;
  acknowledgedDateMs?: number;
}

export async function checkBakongPayment(md5: string): Promise<BakongTransaction | null> {
  const apiToken = token();
  if (!apiToken) throw new Error("BAKONG_API_TOKEN is not configured");
  if (!/^[a-f0-9]{32}$/i.test(md5)) throw new Error("Invalid payment reference");
  const response = await fetch(`${baseUrl()}/v1/check_transaction_by_md5`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ md5 }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const json: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Bakong API returned HTTP ${response.status}`);
  if (json?.responseCode !== 0 || !json?.data) return null;
  return json.data as BakongTransaction;
}
