import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDuelModel } from './learning';
const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
import { duelServerBase, fetchDuelBoard, submitDuelModel } from './online';
afterEach(() => { platform.native = false; vi.unstubAllGlobals(); });
describe('Duel server connection policy', () => {
  it('supports same-origin and local HTTP in the web development build', () => {
    expect(duelServerBase('')).toBe('');
    expect(duelServerBase(' http://127.0.0.1:8787/// ')).toBe('http://127.0.0.1:8787');
    expect(duelServerBase('https://arena.example/api-root/')).toBe('https://arena.example/api-root');
    expect(() => duelServerBase('https://user:secret@arena.example')).toThrow();
    expect(() => duelServerBase('https://arena.example?token=secret')).toThrow();
  });
  it('blocks native HTTP before either loading ranks or sending a model/session', async () => {
    platform.native = true;
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(fetchDuelBoard('http://192.168.1.10:8787')).rejects.toThrow('Mobil uygulamada HTTPS sunucu adresi kullan.');
    await expect(submitDuelModel('http://192.168.1.10:8787', 'Ada', createDuelModel())).rejects.toThrow('Mobil uygulamada HTTPS sunucu adresi kullan.');
    expect(request).not.toHaveBeenCalled();
  });
  it('loads native HTTPS rankings through the configured endpoint', async () => {
    platform.native = true;
    const board = { entries: [], challengeDay: '2026-10-17', ruleset: 'noema-duel-arena-v1-fullpower' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(board), { status: 200 })); vi.stubGlobal('fetch', request);
    await expect(fetchDuelBoard('https://arena.example/')).resolves.toEqual(board);
    expect(request.mock.calls[0][0]).toBe('https://arena.example/api/duel/leaderboard');
  });
});
