// Central registry mapping payerId → adapter instance. Single source of
// truth for which payers have working automation. The fetcher and seeder
// both read this; upgrading a stub to a real adapter is a one-line swap.

import type {PayerAdapter} from "../types.js";
import {aetnaAdapter} from "./aetna.js";
import {cmsMedicareAdapter} from "./cms-medicare.js";
import {uhcAdapter} from "./uhc.js";
import {blueShieldCaAdapter, healthNetCaAdapter} from "./evolent.js";
import {
  anthemAdapter,
  cignaAdapter,
  humanaAdapter,
  kaiserAdapter,
} from "./stubs.js";

export const ALL_ADAPTERS: PayerAdapter[] = [
  cmsMedicareAdapter,
  aetnaAdapter,
  uhcAdapter,
  blueShieldCaAdapter,
  healthNetCaAdapter,
  cignaAdapter,
  anthemAdapter,
  humanaAdapter,
  kaiserAdapter,
];

export const ADAPTERS_BY_ID: Record<string, PayerAdapter> = Object.fromEntries(
  ALL_ADAPTERS.map((a) => [a.meta.payerId, a])
);

export function getAdapter(payerId: string): PayerAdapter | null {
  return ADAPTERS_BY_ID[payerId] ?? null;
}
