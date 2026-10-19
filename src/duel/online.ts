import type { DuelModel } from './learning';
import { ensureArenaSession } from '../lib/arena';
import { Capacitor } from '@capacitor/core';

export interface DuelEvaluation { wins: number; draws: number; losses: number; total: number; damage: number; remainingHp: number; score: number }
export interface DuelArenaEntry extends DuelEvaluation { id: string; name: string; submittedAt: string; modelHash: string }
export interface DuelBoard { entries: DuelArenaEntry[]; challengeDay: string; ruleset: string }
export interface DuelSubmission extends DuelBoard { entry: DuelArenaEntry }

export function duelServerBase(value: string): string {
  const base = value.trim().replace(/\/+$/, '');
  if (!base) return '';
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Geçerli bir HTTP veya HTTPS sunucu adresi gir.');
  if (Capacitor.isNativePlatform() && url.protocol !== 'https:') throw new Error('Mobil uygulamada HTTPS sunucu adresi kullan.');
  return base;
}
async function response<T>(result: Response): Promise<T> {
  let value: T & { error?: string };
  try { value = await result.json(); } catch { throw new Error('Duel sunucusuna bağlanılamadı. Sunucu adresini kontrol et.'); }
  if (!result.ok) throw new Error(value.error || `Bağlantı başarısız (${result.status}).`);
  return value;
}
export async function fetchDuelBoard(base: string, signal?: AbortSignal): Promise<DuelBoard> {
  return response(await fetch(`${duelServerBase(base)}/api/duel/leaderboard`, { signal: signal ?? AbortSignal.timeout(12000) }));
}
export async function submitDuelModel(baseUrl: string, name: string, model: DuelModel): Promise<DuelSubmission> {
  const base = duelServerBase(baseUrl);
  let session = await ensureArenaSession(base, name);
  const send = () => fetch(`${base}/api/duel/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ name, model }), signal: AbortSignal.timeout(45000),
  });
  let result = await send();
  if (result.status === 401) { session = await ensureArenaSession(base, name, true); result = await send(); }
  return response(result);
}
