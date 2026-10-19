import type { NetworkSnapshot } from '../ml/network';

export interface ArenaEntry {
  id: string; name: string; solved: number; total: number; moves: number; submittedAt: string; modelHash: string;
}
export interface ArenaSession { token: string; playerId: string; name: string }
export interface ArenaSubmission { entry: ArenaEntry; entries: ArenaEntry[]; challengeDay: string }

function normalizedBase(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, '');
  if (!value) return '';
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Geçerli bir HTTP veya HTTPS arena adresi gerekli.');
  return value;
}

function sessionKey(base: string): string { return `noema-arena-session:${base || 'same-origin'}`; }
async function readResponse<T>(response: Response): Promise<T> {
  let body: T & { error?: string };
  try { body = await response.json(); } catch { throw new Error('Arena sunucusu geçerli yanıt vermedi.'); }
  if (!response.ok) throw new Error(body.error || `Arena bağlantısı başarısız (${response.status}).`);
  return body;
}

export async function ensureArenaSession(baseUrl: string, name: string, force = false): Promise<ArenaSession> {
  const base = normalizedBase(baseUrl);
  if (!force) {
    try {
      const stored = localStorage.getItem(sessionKey(base));
      if (stored) {
        const session = JSON.parse(stored) as ArenaSession;
        if (/^[A-Za-z0-9_-]{43}$/.test(session.token) && typeof session.playerId === 'string') return session;
      }
    } catch { /* A blocked or damaged local store does not prevent a new guest session. */ }
  }
  const response = await fetch(`${base}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const session = await readResponse<ArenaSession>(response);
  try { localStorage.setItem(sessionKey(base), JSON.stringify(session)); } catch { /* Session still works for this submission. */ }
  return session;
}

export async function submitArenaModel(baseUrl: string, name: string, model: NetworkSnapshot): Promise<ArenaSubmission> {
  const base = normalizedBase(baseUrl);
  let session = await ensureArenaSession(base, name);
  const send = () => fetch(`${base}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ name, model }),
  });
  let response = await send();
  if (response.status === 401) { session = await ensureArenaSession(base, name, true); response = await send(); }
  return readResponse<ArenaSubmission>(response);
}

export async function fetchArenaLeaderboard(baseUrl: string): Promise<{ entries: ArenaEntry[]; challengeDay: string }> {
  return readResponse(await fetch(`${normalizedBase(baseUrl)}/api/leaderboard`));
}
