import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BrainCircuit, Check, ChevronDown, Clock3, Globe2, LoaderCircle, Radio, RefreshCw, ShieldCheck, Sparkles, Swords, Trophy, Upload, Wifi, WifiOff } from 'lucide-react';
import type { DuelModel } from './learning';
import { duelServerBase, fetchDuelBoard, submitDuelModel } from './online';
import type { DuelArenaEntry } from './online';
import { Capacitor } from '@capacitor/core';
import './online.css';

interface Props { page: 'arena' | 'rankings'; model: DuelModel; trained: boolean; onTrain: () => void }
function stored(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* A private session still works. */ } }
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('tr');

export function OnlinePages({ page, model, trained, onTrain }: Props) {
  const [base, setBase] = useState(() => stored('noema-duel-server', ''));
  const [address, setAddress] = useState(base);
  const [name, setName] = useState(() => stored('noema-duel-player', ''));
  const [entries, setEntries] = useState<DuelArenaEntry[]>([]);
  const [day, setDay] = useState('');
  const [connection, setConnection] = useState<'loading' | 'online' | 'offline'>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [lastEntry, setLastEntry] = useState<DuelArenaEntry | null>(null);
  const requestId = useRef(0);
  const nativeNeedsAddress = Capacitor.isNativePlatform() && !base;
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    if (Capacitor.isNativePlatform() && !base) { setConnection('offline'); setEntries([]); setNotice('Ortak arenaya katılmak için sunucu adresini ekle. Atölyede çevrimdışı çalışabilirsin.'); return; }
    setConnection('loading');
    try {
      const board = await fetchDuelBoard(base);
      if (id !== requestId.current) return;
      setEntries(board.entries); setDay(board.challengeDay); setConnection('online'); setNotice('');
    } catch (error) {
      if (id !== requestId.current) return;
      setConnection('offline'); setEntries([]); setDay('');
      setNotice(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Sunucuya ulaşılamadı. Bağlantını ve sunucu adresini kontrol et.');
    }
  }, [base]);
  useEffect(() => { void refresh(); return () => { requestId.current++; }; }, [refresh]);

  const connect = () => {
    try {
      const next = duelServerBase(address);
      save('noema-duel-server', next);
      if (next === base) void refresh(); else setBase(next);
    } catch (error) { setNotice((error as Error).message); }
  };
  const submit = async () => {
    if (!trained || busy || connection !== 'online') return;
    const cleanName = name.normalize('NFC').trim();
    if (!cleanName || [...cleanName].length > 24 || !/^[\p{L}\p{N} _.-]+$/u.test(cleanName)) { setNotice('Oyuncu adını 1–24 harf veya sayı ile yaz.'); return; }
    save('noema-duel-player', cleanName); setBusy(true); setNotice('Robotun sunucuda üç farklı arenada mücadele ediyor…');
    try {
      const result = await submitDuelModel(base, cleanName, model);
      setEntries(result.entries); setDay(result.challengeDay); setLastEntry(result.entry);
      setNotice(`${result.entry.wins} galibiyet, ${result.entry.draws} beraberlik, ${result.entry.losses} mağlubiyet. Günün en iyi sonucun sıralamaya kaydedildi.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Model gönderilemedi.'); }
    finally { setBusy(false); }
  };
  const status = connection === 'online' ? 'Arena bağlı' : connection === 'loading' ? 'Bağlanıyor' : 'Bağlantı yok';
  const statusIcon = connection === 'online' ? <Wifi size={14}/> : connection === 'loading' ? <LoaderCircle size={14} className="du-online-spin"/> : <WifiOff size={14}/>;

  return <div className={`du-online du-online-${page}`}>
    <header className="du-online-heading">
      <div><div className="du-online-kicker"><span/>{page === 'arena' ? 'NOEMA DUEL' : 'GÜNÜN ROBOTLARI'}</div><h1>{page === 'arena' ? <>Online <em>Arena</em></> : <>Günlük <em>sıralama</em></>}</h1><p>{page === 'arena' ? 'Robotunu ortak koşullarda yarıştır.' : 'Aynı rakipler. Sunucuda doğrulanan sonuçlar.'}</p></div>
      <div className={`du-online-connection ${connection}`} role="status">{statusIcon}{status}</div>
    </header>

    {page === 'arena' ? <div className="du-online-arena-grid">
      <section className="du-online-feature">
        <div className="du-online-feature-top"><span><Radio size={13}/> GÜNLÜK ARENA</span><ShieldCheck size={21}/></div>
        <div className="du-online-orbit" aria-hidden="true"><i/><i/><i/><div className="du-online-orbit-brain"><BrainCircuit size={61} strokeWidth={1.2}/></div><span className="du-online-orbit-spark"><Sparkles size={17}/></span><span className="du-online-orbit-swords"><Swords size={22}/></span></div>
        <h2>Üç arena.<br/><em>Senin eğittiğin robot.</em></h2>
        <p>Modelin, sunucunun rakiplerine karşı kendi kararlarıyla oynar.</p>
        <div className="du-online-rule-list"><span><Check size={15}/>3 arena, her biri en fazla 120 saniye</span><span><Check size={15}/>Herkese aynı günlük koşullar</span><span><Check size={15}/>Puanlar sunucuda hesaplanır</span></div>
        <div className="du-online-challenge-meta"><span><Swords size={17}/><b>3 düello</b></span><span><Clock3 size={17}/><b>Günlük sıralama</b></span><span><ShieldCheck size={17}/><b>Eşit mimari</b></span></div>
      </section>

      <div className="du-online-side">
        <section className="du-online-card du-online-submit">
          <div className="du-online-card-title"><span className="du-online-icon"><Upload size={19}/></span><div><h2>Arenaya katıl</h2><p>Atölyendeki modelinle.</p></div><span className={`du-online-model-status ${trained ? 'ready' : ''}`}>{trained ? 'Model hazır' : 'Eğitim gerekli'}</span></div>
          {trained ? <><label className="du-online-field">Oyuncu adın<input aria-label="Arena oyuncu adı" value={name} onChange={e => setName(e.target.value)} maxLength={24} placeholder="Sıralamada görünecek adın" autoComplete="nickname" disabled={busy}/></label><button className="du-online-primary" onClick={() => { void submit(); }} disabled={busy || connection !== 'online'}>{busy ? <LoaderCircle size={17} className="du-online-spin"/> : <Swords size={17}/>} {busy ? 'Robotun mücadele ediyor…' : 'Modelimi arenaya gönder'}{!busy && <ArrowRight size={16}/>}</button><p className="du-online-fine">Yalnızca model ağırlıkların gönderilir. Günlük en iyi sonucun korunur.</p></> : <><div className="du-online-teach"><BrainCircuit size={28}/><p>Önce robotuna hareket etmeyi, hedef almayı ve siper kullanmayı göster.</p></div><button className="du-online-primary" onClick={onTrain}>Atölyeye git <ArrowRight size={16}/></button></>}
          {lastEntry && <div className="du-online-result"><Trophy size={23}/><div><strong>{lastEntry.score.toLocaleString('tr-TR')} puan</strong><span>{lastEntry.wins} G · {lastEntry.draws} B · {lastEntry.losses} M</span></div><span>{lastEntry.damage} hasar</span></div>}
        </section>
        <section className="du-online-card du-online-preview"><div className="du-online-section-title"><h2><Trophy size={17}/> Arenadan</h2><span>{entries.length ? `${entries.length} robot` : 'Günlük tablo'}</span></div><Board entries={entries.slice(0, 3)} loading={connection === 'loading'} connected={connection === 'online'} compact/></section>
      </div>
    </div> : <section className="du-online-card du-online-rankings">
      <div className="du-online-section-title"><div><h2><Trophy size={19}/> Günlük sıralama</h2><p>{day ? `${new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))} · UTC gününe göre` : 'Her gün yeni ortak koşullar'}</p></div><button className="du-online-refresh" aria-label="Duel sıralamasını yenile" onClick={() => { void refresh(); }} disabled={busy || connection === 'loading'}><RefreshCw size={16} className={connection === 'loading' ? 'du-online-spin' : ''}/><span>Yenile</span></button></div>
      {entries.length > 0 && <div className="du-online-board-head"><span>SIRA / OYUNCU</span><span>G / B / M</span><span>PUAN</span></div>}
      <Board entries={entries} loading={connection === 'loading'} connected={connection === 'online'}/>
      <div className="du-online-ranking-note"><ShieldCheck size={16}/><p>Galibiyet 10.000, beraberlik 3.000 puan. Verilen hasar ve kalan can eklenir. Yalnızca sunucunun oynattığı düellolar sıralamaya girer.</p></div>
    </section>}

    <div className="du-online-footer"><div className={`du-online-notice ${connection === 'offline' ? 'offline' : ''}`} role="status">{notice || (connection === 'online' ? 'Bağlısın. Sonuçlar ortak Duel sunucusundan gelir.' : 'Arena bağlantısı kontrol ediliyor…')}</div><details className="du-online-settings" open={nativeNeedsAddress || undefined}><summary><Globe2 size={15}/> Arena bağlantısı <ChevronDown size={14}/></summary><div><label className="du-online-field">Sunucu adresi<input aria-label="Duel sunucu adresi" inputMode="url" value={address} onChange={e => setAddress(e.target.value)} placeholder="https://arena.sunucun.com" disabled={busy}/></label><button className="du-online-secondary" onClick={connect} disabled={busy}>Bağlan <ArrowRight size={15}/></button></div><p>Aynı adrese bağlanan oyuncular ortak sıralamayı paylaşır. Web sürümünde boş bırakılırsa bu sitenin sunucusu kullanılır.</p></details></div>
  </div>;
}

function Board({ entries, loading, connected, compact = false }: { entries: DuelArenaEntry[]; loading: boolean; connected: boolean; compact?: boolean }) {
  if (loading) return <div className="du-online-empty"><LoaderCircle size={29} className="du-online-spin"/><h3>Arena kontrol ediliyor</h3><p>Ortak sıralama yükleniyor.</p></div>;
  if (!entries.length) return <div className="du-online-empty">{connected ? <Trophy size={33}/> : <Globe2 size={33}/>}<h3>{connected ? 'İlk hamleye yer var.' : 'Arena seni bekliyor.'}</h3><p>{connected ? 'Bugün henüz bir sonuç yok. Eğittiğin robotla ilk sırayı sen aç.' : 'Sunucuya bağlandığında gerçek oyuncuların robotları burada görünecek.'}</p></div>;
  return <div className={`du-online-board ${compact ? 'compact' : ''}`}>{entries.map((entry, index) => <div className="du-online-row" key={entry.id}><span className={`du-online-rank rank-${index + 1}`}>{String(index + 1).padStart(2, '0')}</span><div className="du-online-avatar" aria-hidden="true">{initials(entry.name)}</div><div className="du-online-player"><strong>{entry.name}</strong><small><ShieldCheck size={11}/>{entry.modelHash.slice(0, 8)} · doğrulandı</small></div><span className="du-online-record">{entry.wins}<i>/</i>{entry.draws}<i>/</i>{entry.losses}</span><div className="du-online-score"><strong>{entry.score.toLocaleString('tr-TR')}</strong><small>{entry.damage} hasar</small></div></div>)}</div>;
}
