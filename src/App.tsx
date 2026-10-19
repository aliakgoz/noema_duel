import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Box, Camera, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Download, FlaskConical, Globe2, GraduationCap, Layers3, Maximize2, MoreHorizontal, Pause, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Trophy, Upload, Volume2, VolumeX, X, Zap } from 'lucide-react';
import type { Action, GameState, Level } from './core/types';
import { ACTION_KEYS, ACTION_NAMES, MODEL_INPUTS } from './core/types';
import { createState, getProgress, step } from './core/engine';
import { LEVELS, generateChallenge } from './core/levels';
import { encodeObservation } from './core/observation';
import { TinyNetwork, MAX_MODEL_BYTES } from './ml/network';
import type { ActivationTrace, TrainingMetrics, TrainingProgress, TrainingSample } from './ml/network';
import { trainInWorker } from './ml/training';
import { augmentSamples, normalizeTrainingSamples, type ContextualTrainingSample } from './ml/dataset';
import { BrainCanvas } from './components/BrainCanvas';
import { TransferPanel } from './components/TransferPanel';
import { RoomGuide } from './components/RoomGuide';
import { WorkshopToolbar } from './components/WorkshopToolbar';
import { createTransferVariant } from './core/variants';
import { TRANSFER_BUDGET, type TransferReport } from './evaluation/transfer';
import { evaluateTransferInWorker } from './evaluation/client';
import { GameScene } from './render/GameScene';
import { CAMERA_VIEWS, type CameraView } from './render/cameraViews';
import { RobotCadence } from './render/robotCadence';
import { readRecord, writeRecord } from './lib/storage';
import { setSound, sound } from './lib/audio';
import { fetchArenaLeaderboard, submitArenaModel } from './lib/arena';
import { saveModelFile } from './lib/platform';
import { Capacitor } from '@capacitor/core';
import { usePlayableFullscreen } from './lib/playableFullscreen';
import './components/playableFullscreen.css';

type Page = 'workshop' | 'curriculum' | 'arena' | 'journal';
type Sample = ContextualTrainingSample & { id: number; levelId: string; accepted: boolean };
type Frame = { before: GameState; after: GameState; action: Action; source: 'human' | 'robot'; trace: ActivationTrace; memoryAfter: number[] };
type WeatherMode = 'auto' | 'clear' | 'rain';
type Profile = { model: string; samples: Sample[]; completed: Record<string, number>; name: string; sound: boolean; quality: 'high'|'balanced'; weather?: WeatherMode; metrics?: TrainingMetrics; revision: number };
type Entry = { id: string; name: string; solved: number; total: number; moves: number; submittedAt: string; modelHash: string };
const NAV = [{ id: 'workshop', icon: FlaskConical, label: 'Atölye' }, { id: 'curriculum', icon: Layers3, label: 'Keşifler' }, { id: 'arena', icon: Trophy, label: 'Arena' }, { id: 'journal', icon: BookOpen, label: 'Günlük' }] as const;
const CHAPTERS = ['İlk kıvılcım', 'Birlikte bağlantı kur', 'Olasılıklar bahçesi', 'Buzun hafızası', 'Akışın mimarisi', 'Sıraların ardında', 'Birbirine açılan odalar'];
const HISTORY_LIMIT = 400;
const PROFILE_KEY = 'profile-gru96-v3';

export default function App() {
  const [page, setPage] = useState<Page>('workshop');
  const { host: playableHost, active: fullscreen, activeRef: fullscreenRef, open: openFullscreen, close: closeFullscreen } = usePlayableFullscreen();
  const [game, setGame] = useState(() => createState(LEVELS[0]));
  const gameRef = useRef(game);
  const lesson = useRef(LEVELS[0]);
  const [transferReport, setTransferReport] = useState<TransferReport>();
  const [evaluating, setEvaluating] = useState(false);
  const abortEvaluation = useRef<AbortController | null>(null);
  const network = useRef<TinyNetwork>(null!);
  if (!network.current) network.current = new TinyNetwork(42);
  const [trace, setTrace] = useState<ActivationTrace>();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [completed, setCompleted] = useState<Record<string, number>>({});
  const [metrics, setMetrics] = useState<TrainingMetrics>();
  const [revision, setRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [robotRunId, setRobotRunId] = useState(0);
  const [training, setTraining] = useState<TrainingProgress | null>(null);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const abortTraining = useRef<AbortController | null>(null);
  const [lastKey, setLastKey] = useState<number>(-1);
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [frames, setFrames] = useState<Frame[]>([]);
  const history = useRef<Action[]>([]);
  const humanEpisode = useRef<{ id: string; count: number } | null>(null);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBrain, setShowBrain] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [name, setName] = useState('N-01');
  const [audio, setAudio] = useState(true);
  const [quality, setQuality] = useState<'high'|'balanced'>('high');
  const [weather, setWeather] = useState<WeatherMode>('auto');
  const weatherRef = useRef<WeatherMode>('auto');
  const [cameraView, setCameraView] = useState<CameraView>(0);
  const cameraViewRef = useRef<CameraView>(0);
  const [atmospherePhase, setAtmospherePhase] = useState<'clear'|'cloudy'|'rain'>('clear');
  const atmospherePhaseRef = useRef<'clear'|'cloudy'|'rain'>('clear');
  const onAtmosphereChange = useCallback((snapshot: { phase: 'clear'|'cloudy'|'rain' }) => {
    if (atmospherePhaseRef.current === snapshot.phase) return;
    atmospherePhaseRef.current = snapshot.phase; setAtmospherePhase(snapshot.phase);
  }, []);
  const [online, setOnline] = useState(navigator.onLine);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveStateValue] = useState('Yükleniyor');
  const saveStateRef = useRef('Yükleniyor');
  const setSaveState = useCallback((next: string) => {
    // Avoid adding a passive update after every key while a save is already pending.
    if (saveStateRef.current === next) return;
    saveStateRef.current = next; setSaveStateValue(next);
  }, []);
  const saveGeneration = useRef(0);
  const sceneHost = useRef<HTMLDivElement>(null);
  const scene = useRef<GameScene | null>(null);
  const [sceneError, setSceneError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const [arenaUrl, setArenaUrl] = useState(localStorage.getItem('noema-arena-url') ?? '');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [arenaStatus, setArenaStatus] = useState('');
  const [arenaBusy, setArenaBusy] = useState(false);
  const accepted = useMemo(() => samples.filter(s => s.accepted), [samples]);
  const canonicalCompleted = useMemo(() => LEVELS.filter(level => completed[level.id] !== undefined).length, [completed]);
  const progress = getProgress(game);
  const visibleGame = replayAt === null ? game : (frames[replayAt]?.after ?? game);
  const visibleTrace = replayAt === null ? trace : frames[replayAt]?.trace;

  const notify = useCallback((message: string) => {
    setToast(message); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);

  useEffect(() => {
    let alive = true;
    readRecord<Profile>(PROFILE_KEY).then(profile => {
      if (!alive) return;
      if (profile) {
        try { network.current = TinyNetwork.deserialize(profile.model); } catch { notify('Model kaydı okunamadı. Eğitim örneklerin korundu.'); }
        try { setSamples(normalizeTrainingSamples(Array.isArray(profile.samples) ? profile.samples.slice(-5000) : [])); }
        catch { notify('Bazı eski örnekler okunamadı. Modelin korunuyor.'); }
        setCompleted(profile.completed ?? {}); setName(profile.name || 'N-01'); setAudio(profile.sound ?? true);
        setQuality(profile.quality ?? 'high'); setWeather(profile.weather ?? 'auto'); setMetrics(profile.metrics); setRevision(profile.revision ?? 0);
      }
    }).catch(() => notify('Cihaz kaydı açılamadı. Özel tarama ayarlarını kontrol et.')).finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [notify]);

  useEffect(() => { setSound(audio); }, [audio]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    if (!loaded || trainingBusy) return;
    const generation = ++saveGeneration.current;
    setSaveState('Kaydediliyor');
    const timer = setTimeout(() => {
      writeRecord(PROFILE_KEY, { model: network.current.serialize(), samples, completed, name, sound: audio, quality, weather, metrics, revision } satisfies Profile)
        .then(() => { if (saveGeneration.current === generation) setSaveState('Kaydedildi'); }).catch(() => { if (saveGeneration.current === generation) setSaveState('Kayıt başarısız'); notify('Depolama dolu olabilir. Modelini dışa aktararak koruyabilirsin.'); });
    }, 400);
    return () => clearTimeout(timer);
  }, [loaded, samples, completed, name, audio, quality, weather, metrics, revision, trainingBusy, notify, setSaveState]);

  useEffect(() => {
    if (page !== 'workshop' || !sceneHost.current) return;
    try {
      const next = new GameScene(sceneHost.current, visibleGame, { quality, onAtmosphereChange }); scene.current = next; setSceneError('');
      next.setWeather(weatherRef.current);
      next.setCameraView(cameraViewRef.current);
      next.setTrainingPaused(trainingBusy);
      return () => { next.dispose(); scene.current = null; };
    } catch (error) { setSceneError(error instanceof Error ? error.message : '3B görünüm açılamadı.'); }
  }, [page, quality, onAtmosphereChange]);
  useEffect(() => { weatherRef.current = weather; scene.current?.setWeather(weather); }, [weather]);
  useEffect(() => { cameraViewRef.current = cameraView; scene.current?.setCameraView(cameraView); }, [cameraView]);
  useEffect(() => { scene.current?.setTrainingPaused(trainingBusy); }, [trainingBusy, page, quality]);
  useEffect(() => { scene.current?.update(visibleGame); }, [visibleGame]);
  useEffect(() => { setTrace(network.current.preview(encodeObservation(gameRef.current, history.current)).trace); }, [loaded, revision]);

  const stopRobot = useCallback(() => { runningRef.current = false; setRunning(false); }, []);
  useEffect(() => { if (page !== 'workshop') { stopRobot(); closeFullscreen(); } }, [page, stopRobot, closeFullscreen]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false; let remove: (() => Promise<void>) | undefined;
    void import('@capacitor/app').then(async ({ App: NativeApp }) => {
      const handle = await NativeApp.addListener('backButton', () => {
        if (fullscreenRef.current) closeFullscreen();
        else if (showHelp || showSettings || showBrain || showSamples) { setShowHelp(false); setShowSettings(false); setShowBrain(false); setShowSamples(false); }
        else if (trainingBusy) abortTraining.current?.abort();
        else if (evaluating) abortEvaluation.current?.abort();
        else if (runningRef.current) stopRobot();
        else if (page !== 'workshop') setPage('workshop');
        else void NativeApp.exitApp();
      });
      if (disposed) await handle.remove(); else remove = () => handle.remove();
    });
    return () => { disposed = true; void remove?.(); };
  }, [page, showHelp, showSettings, showBrain, showSamples, trainingBusy, evaluating, stopRobot, closeFullscreen, fullscreenRef]);
  const changeLevel = useCallback((level: Level) => {
    abortEvaluation.current?.abort(); setTransferReport(undefined);
    // Explicit variants retain their original room, including rotated challenges.
    // Selecting a different lesson establishes a new base for subsequent variants.
    if (!level.variantKind) lesson.current = level;
    else if ((lesson.current.sourceLevelId ?? lesson.current.id) !== (level.sourceLevelId ?? level.id))
      lesson.current = LEVELS.find(candidate => candidate.id === level.sourceLevelId) ?? level;
    stopRobot(); const state = createState(level); gameRef.current = state; history.current = [];
    humanEpisode.current = null; network.current.resetMemory();
    scene.current?.beginTrial(state);
    setGame(state); setFrames([]); setReplayAt(null); setLastKey(-1); setPage('workshop');
    setTrace(network.current.preview(encodeObservation(state)).trace); sound('click');
  }, [stopRobot]);

  function changeToSimilarLevel() {
    if (trainingBusy || evaluating || !loaded) return;
    const base = lesson.current;
    const currentTiles = gameRef.current.level.tiles.join('\n');
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    try {
      for (let attempt = 0; attempt < 16; attempt++) {
        const variant = createTransferVariant(base, (seed + attempt * 2654435761) >>> 0, 'layout');
        if (variant.tiles.join('\n') === currentTiles) continue;
        changeLevel(variant);
        notify('Benzer bölüm hazır. Bir engel değişti; başlangıç, hedefler ve nesneler aynı.');
        return;
      }
      notify('Bu bölümde başka bir güvenli değişiklik bulunamadı. Asıl düzene dönebilir veya başka bölüm seçebilirsin.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Benzer bölüm hazırlanamadı.');
    }
  }

  const act = useCallback((requestedAction: Action | undefined, source: 'human'|'robot' = 'human') => {
    const before = gameRef.current;
    if (before.solved || trainingBusy || !loaded || (source === 'human' && requestedAction === undefined)) return;
    if (source === 'human' && !humanEpisode.current) {
      network.current.resetMemory();
      humanEpisode.current = { id: crypto.randomUUID(), count: 0 };
    } else if (source === 'robot') humanEpisode.current = null;
    const historyBefore = [...history.current];
    const input = encodeObservation(before, historyBefore);
    const prediction = network.current.predict(input);
    const action = source === 'robot' ? prediction.action : requestedAction!;
    const after = step(before, action);
    const memoryAfter = Array.from(network.current.getMemory());
    gameRef.current = after;
    history.current = [...history.current, action].slice(-16);
    setGame(after); setTrace(prediction.trace); setLastKey(action);
    clearTimeout(keyTimer.current); keyTimer.current = setTimeout(() => setLastKey(-1), 220);
    setFrames(previous => [...previous, { before, after, action, source, trace: prediction.trace, memoryAfter }].slice(-HISTORY_LIMIT));
    if (source === 'human') {
      const episode = humanEpisode.current!;
      const sequenceStart = episode.count++ === 0;
      setSamples(previous => [...previous, { input: Array.from(input), action, episodeId: episode.id, sequenceStart, observationState: before, history: historyBefore, id: Date.now() + Math.random(), levelId: before.level.id, accepted: true }].slice(-5000));
    }
    sound(action === 4 ? 'interact' : 'step');
    if (after.solved) {
      stopRobot(); sound('success');
      if (source === 'human') setCompleted(previous => ({ ...previous, [after.level.id]: Math.min(previous[after.level.id] ?? Infinity, after.moves) }));
      notify(source === 'robot' ? `${name} çözdü. Öğrettiklerin bir çözüme dönüştü!` : 'Çözdün! Şimdi bu deneyimi robotuna öğretebilirsin.');
    }
  }, [trainingBusy, loaded, stopRobot, notify, name]);
  const actRef = useRef(act); useEffect(() => { actRef.current = act; }, [act]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || showHelp || showSettings || showSamples || showBrain || page !== 'workshop' || trainingBusy || replayAt !== null) return;
      if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;
      const map: Record<string, Action> = { ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1, ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3, e: 4, E: 4, ' ': 4, z: 5, Z: 5 };
      if (event.key in map) { event.preventDefault(); if (runningRef.current) stopRobot(); actRef.current(map[event.key]); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [page, replayAt, showHelp, showSettings, showSamples, showBrain, trainingBusy, stopRobot]);

  useEffect(() => {
    if (!running) return;
    let count = 0;
    const visited = new Map<string, number>();
    const cadence = new RobotCadence(performance.now());
    let frameId = 0;
    const advance = (now: number) => {
      if (!runningRef.current) return;
      // A slow GPU must finish the current pose before the model can request another.
      // Both human and robot actions still use the same act() and scene interpolation.
      if (!cadence.ready(now, scene.current?.isReadyForAction() ?? false)) {
        frameId = requestAnimationFrame(advance); return;
      }
      if (gameRef.current.solved || count++ >= TRANSFER_BUDGET) { stopRobot(); if (!gameRef.current.solved) notify('Robot burada zorlandı. Bir düzeltme örneği göstererek yardımcı olabilirsin.'); return; }
      const current = gameRef.current;
      const key = JSON.stringify([current.robot, current.crates, current.switches.map(item => item.on), current.sequenceProgress, history.current.slice(-2), Array.from(network.current.getMemory())]);
      const visits = (visited.get(key) ?? 0) + 1; visited.set(key, visits);
      if (visits >= 4) { stopRobot(); notify('Robot aynı duruma dönüyor. Buradan doğru hamleyi gösterip Robotuna öğret ile bu hatayı çalışabilirsin.'); return; }
      actRef.current(undefined, 'robot');
      cadence.didAct(now);
      if (runningRef.current) frameId = requestAnimationFrame(advance);
    };
    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [running, robotRunId, stopRobot, notify]);

  useEffect(() => {
    const pause = () => { if (document.hidden) { stopRobot(); abortTraining.current?.abort(); abortEvaluation.current?.abort(); } };
    document.addEventListener('visibilitychange', pause); return () => document.removeEventListener('visibilitychange', pause);
  }, [stopRobot]);

  async function train() {
    if (accepted.length < 2 || trainingBusy || evaluating) return;
    stopRobot(); setReplayAt(null); setTrainingBusy(true); setTraining(null);
    humanEpisode.current = null;
    const snapshot = network.current.serialize(); const controller = new AbortController(); abortTraining.current = controller;
    try {
      const examples = augmentSamples(accepted, { symmetries: true, translations: true, restartViews: false, maxSamples: 3000 });
      const epochs = Math.max(6, Math.min(120, Math.ceil(18000 / examples.length)));
      const trained = await trainInWorker(network.current, examples, { epochs, batchSize: 16, onProgress: setTraining, signal: controller.signal });
      network.current = trained.network;
      network.current.resetMemory();
      setFrames([]); setReplayAt(null);
      const result = trained.metrics;
      setMetrics(result); setRevision(value => value + 1); setTransferReport(undefined); setTrace(network.current.preview(encodeObservation(gameRef.current, history.current)).trace);
      notify(`Eğitim tamamlandı. Örneklerine uyum: %${Math.round(result.accuracy * 100)}.`); sound('success');
    } catch (error) {
      network.current = TinyNetwork.deserialize(snapshot);
      notify(controller.signal.aborted ? 'Eğitim durduruldu. Önceki modelin korundu.' : `Eğitim tamamlanamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
    } finally { setTrainingBusy(false); setTraining(null); abortTraining.current = null; }
  }

  function runRobot() {
    if (runningRef.current) { stopRobot(); return; }
    if (evaluating || trainingBusy || !loaded) return;
    if (replayAt !== null) {
      const frame = frames[replayAt];
      if (frame) {
        // Resume the state actually displayed in replay, including recurrent memory.
        gameRef.current = frame.after;
        network.current.setMemory(frame.memoryAfter);
        history.current = frames.slice(0, replayAt + 1).map(item => item.action).slice(-16);
        setGame(frame.after); setFrames(previous => previous.slice(0, replayAt + 1));
      }
      setReplayAt(null);
    }
    if (gameRef.current.solved) { runRobotFromStart(); return; }
    // Hand control to the model at this exact square; no hidden variant or reset.
    startRobotPlayback();
  }

  function runRobotFromStart() {
    if (evaluating || trainingBusy || !loaded) return;
    const level = replayAt === null ? gameRef.current.level : (frames[replayAt]?.after.level ?? gameRef.current.level);
    const state = createState(level); gameRef.current = state; history.current = [];
    humanEpisode.current = null; network.current.resetMemory();
    scene.current?.beginTrial(state);
    setGame(state); setFrames([]); setReplayAt(null); setLastKey(-1);
    startRobotPlayback();
  }

  function startRobotPlayback() {
    humanEpisode.current = null;
    setTrace(network.current.preview(encodeObservation(gameRef.current, history.current)).trace);
    runningRef.current = true; setRunning(true); setRobotRunId(value => value + 1); sound('click');
    if (!metrics) notify('Robot henüz eğitim almadı. Önce bir çözüm gösterip Öğret düğmesine dokunabilirsin.');
  }
  async function testTransfer() {
    if (evaluating || trainingBusy || !loaded) return;
    stopRobot(); const controller = new AbortController(); abortEvaluation.current = controller; setEvaluating(true); setTransferReport(undefined);
    try {
      const report = await evaluateTransferInWorker(network.current.snapshot(), lesson.current, crypto.getRandomValues(new Uint32Array(1))[0], controller.signal);
      setTransferReport(report); notify(`Deneme tamamlandı: ${report.cases.filter(trial => trial.solved).length}/${report.cases.length} koşulda çözdü.`);
    } catch (error) { if (!controller.signal.aborted) notify(error instanceof Error ? error.message : 'Deneme tamamlanamadı.'); }
    finally { if (abortEvaluation.current === controller) { abortEvaluation.current = null; setEvaluating(false); } }
  }
  async function exportModel() {
    try { await saveModelFile(`noema-${name.replace(/[^a-zA-Z0-9_-]/g,'-').toLowerCase()}-v${revision}.json`, network.current.serialize()); }
    catch { notify('Model dışa aktarma tamamlanmadı. Kaydın cihazında korunuyor.'); }
  }
  async function importModel(file?: File) {
    if (!file) return;
    if (trainingBusy || evaluating) { notify('Model yüklemeden önce devam eden eğitim veya denemeyi durdur.'); return; }
    if (file.size > MAX_MODEL_BYTES) { notify('Model dosyası çok büyük.'); return; }
    try { const next = TinyNetwork.deserialize(await file.text()); stopRobot(); humanEpisode.current = null; network.current = next; setFrames([]); setReplayAt(null); setRevision(value => value + 1); setMetrics(undefined); setTransferReport(undefined); notify('GRU modeli doğrulandı ve yüklendi.'); }
    catch { notify('Bu dosya NOEMA model sözleşmesine uygun değil.'); }
  }
  const baseUrl = arenaUrl.replace(/\/$/, '');
  async function refreshArena() {
    setArenaBusy(true); setArenaStatus('Arena sunucusuna bağlanılıyor…');
    try { const json = await fetchArenaLeaderboard(baseUrl); setEntries(json.entries); setArenaStatus('Resmi değerlendirme sunucusu bağlı.'); }
    catch { setArenaStatus('Arena sunucusuna ulaşılamıyor. Çevrimdışı eğitimine devam edebilirsin.'); }
    finally { setArenaBusy(false); }
  }
  async function submitArena() {
    if (!metrics) { notify('Yarışa göndermeden önce robotuna bir çözüm öğret.'); return; }
    setArenaBusy(true); setArenaStatus('Model sunucuda görülmemiş bulmacalarda değerlendiriliyor…');
    try {
      const json = await submitArenaModel(baseUrl, name, network.current.snapshot());
      setEntries(json.entries); setArenaStatus(`${json.entry.solved}/${json.entry.total} bulmaca çözüldü. Sonuç sunucuda hesaplandı.`);
    } catch (error) { setArenaStatus(error instanceof Error ? error.message : 'Sunucuya bağlanılamadı.'); }
    finally { setArenaBusy(false); }
  }

  const activePage = NAV.find(item => item.id === page)!;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('workshop'); }} aria-label="NOEMA Atölye"><span className="brand-mark">N<span/></span><span>NOEMA<small>ROBOT AKADEMİSİ</small></span></a>
      <div className="sidebar-divider"/>
      <div className="nav-caption">SENİN DÜNYAN</div>
      <nav>{NAV.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { stopRobot(); setPage(item.id); sound('click'); }}><item.icon size={19}/><span>{item.label}</span>{item.id === 'arena' ? <span className="nav-tag">8</span> : item.id === 'workshop' && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="robot-profile"><div className="robot-avatar"><i/><i/></div><div><strong>{name}</strong><span>Senin öğrencin</span></div><span className="status-dot"/></div><div className="level-progress"><span>Birlikte büyüyorsunuz <b>{canonicalCompleted}/{LEVELS.length}</b></span><div><i style={{ width: `${canonicalCompleted / LEVELS.length * 100}%` }}/></div></div><button className="sidebar-settings" onClick={() => setShowSettings(true)}><Settings2 size={16}/> Ayarlar <span>⌘</span></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><activePage.icon size={15}/><span>{activePage.label}</span><ChevronRight size={13}/><strong>{page === 'workshop' ? 'Öğrenme laboratuvarı' : page === 'curriculum' ? 'Yeni olasılıklar' : page === 'arena' ? 'Ortak zihinler' : 'Birlikte katettiğiniz yol'}</strong></div><div className="top-actions"><span className={`connection ${online ? '' : 'offline'}`}>{online ? <span className="status-dot"/> : <CloudOff size={13}/>} {online ? 'Çevrimdışı oynamaya hazır' : 'Çevrimdışı'}</span><button className="icon-button" onClick={() => setShowHelp(true)} aria-label="Nasıl oynanır"><CircleHelp size={18}/></button><button className="profile-circle" onClick={() => setShowSettings(true)}>T</button></div></header>
      <main>
        {page === 'workshop' && <>
          <div className="page-heading"><div><div className="eyebrow"><span/> BİRLİKTE ÖĞRENİN, BİRLİKTE KEŞFEDİN</div><h1>Her zihin bir <em>başlangıç.</em></h1><p>Sen çöz. Robotun izlesin. Sonra kendi yolunu bulsun.</p></div><button className="button button-outline discover-button" onClick={() => setPage('curriculum')}><Layers3 size={16}/> Bulmacaları keşfet <ArrowRight size={15}/></button></div>
          <div className="workshop-grid">
            <section ref={playableHost} className={`world-card ${fullscreen ? 'playable-fullscreen' : ''}`} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? 'Tam ekran oyun alanı' : undefined}>
              <div className="playable-fullscreen-bar"><strong>{game.level.title}</strong><div className="playable-fullscreen-actions">
                {trainingBusy ? <><div className="fullscreen-training-progress" role="status"><BrainCircuit size={16}/><span>Öğreniyor<small>{training ? `${training.epoch}/${training.totalEpochs} tur` : 'Hazırlanıyor…'}</small></span><progress aria-label="Eğitim ilerlemesi" max={training?.totalEpochs ?? 1} value={training?.epoch ?? 0}/></div><button className="button button-outline" aria-label="Eğitimi durdur" onClick={() => abortTraining.current?.abort()}><Pause size={15}/><span>Durdur</span></button></> : <>
                  <button className="button button-outline fullscreen-watch" aria-label={running ? 'Robotu durdur' : 'Robotu izle'} onClick={runRobot} disabled={evaluating || !loaded}>{running ? <Pause size={16}/> : <Play size={16}/>}<span>{running ? 'Robotu durdur' : 'Robotu izle'}</span></button>
                  <button className="button button-primary fullscreen-teach" aria-label="Robotuna öğret" disabled={accepted.length < 2 || evaluating || !loaded} onClick={train}><BrainCircuit size={16}/><span>Robotuna öğret</span><small>{accepted.length}</small></button>
                  {game.level.surfaces?.some(tile => tile.kind === 'conveyor') && <button className="button button-outline fullscreen-wait" aria-label="Bekle" disabled={replayAt !== null} onClick={() => { stopRobot(); act(5); }}><Pause size={14}/><span>Z</span></button>}
                </>}
                <button className="button button-outline fullscreen-exit" data-fullscreen-exit aria-label="Tam ekrandan çık" onClick={() => closeFullscreen()}><X size={18}/><span>Tam ekrandan çık</span></button>
              </div></div>
              <div className="world-header"><div className="lesson-index">{game.level.surprise ? <Sparkles size={16}/> : String(LEVELS.findIndex(l => l.id === (game.level.sourceLevelId ?? game.level.id)) + 1).padStart(2, '0')}</div><div><div className="world-chapter">{game.level.surprise ? 'GÖRÜLMEMİŞ DÜZEN' : `BÖLÜM ${game.level.chapter} · ${CHAPTERS[game.level.chapter - 1]?.toLocaleUpperCase('tr')}`}</div><h2>{game.level.title}</h2></div><button className="icon-button world-menu" aria-label="Bulmaca açıklaması" onClick={() => notify(game.level.description)}><MoreHorizontal size={21}/></button></div>
              <div className="world-viewport"><div className="scene-host" ref={sceneHost}/>{sceneError && <div className="scene-error"><strong>3B görünüm açılamadı</strong><p>{sceneError}</p><button className="button" onClick={() => setQuality('balanced')}>Dengeli kaliteyi dene</button></div>}<div className="scene-top"><span className={`mode-pill ${running ? 'robot' : ''}`}><span/>{replayAt !== null ? 'TEKRAR İZLENİYOR' : trainingBusy ? 'DENEYİMLERİ ÖĞRENİYOR' : running ? `${name} ÇÖZÜYOR` : 'SENİN KONTROLÜN'}</span><div className="scene-tools"><button className="weather-pill" aria-label={`Hava durumunu değiştir: ${weather === 'auto' ? 'Otomatik' : weather === 'rain' ? 'Yağmurlu' : 'Açık'}`} onClick={() => setWeather(weather === 'auto' ? 'rain' : weather === 'rain' ? 'clear' : 'auto')} title="Otomatik, yağmurlu ve açık hava arasında geçiş">{atmospherePhase === 'rain' ? '☂ YAĞMUR' : atmospherePhase === 'cloudy' ? '⛅ PARÇALI BULUTLU' : '☀ GÜNEŞLİ'}<small>{weather === 'auto' ? 'OTOMATİK' : weather === 'rain' ? 'YAĞMURLU' : 'AÇIK'}</small></button><span className="scene-seed">{game.level.variantKind ? 'AKTARIM DENEMESİ' : game.level.surprise ?? 'ÖĞRENME ALANI'}</span></div></div><div className="scene-bottom"><span><Box size={14}/>{game.level.subtitle}</span><div className="scene-view-actions"><button className="camera-toggle" aria-label={`Bakış açısını değiştir: ${CAMERA_VIEWS[cameraView].label}`} title={`NOEMA INC / CAM 0${cameraView + 1} / ${CAMERA_VIEWS[cameraView].label}`} onClick={() => setCameraView(((cameraView + 1) % CAMERA_VIEWS.length) as CameraView)}><Camera size={15}/><span>CAM 0{cameraView + 1}</span></button><button className="icon-button" data-fullscreen-enter aria-label="Görünümü büyüt" onClick={openFullscreen}><Maximize2 size={15}/></button></div></div>{game.solved && replayAt === null && <div className="solved-banner"><div><Check size={21}/></div><span><strong>{running ? 'Birlikte başardınız' : 'Yeni bir çözüm keşfettin'}</strong><small>{game.moves} hamle · Bu deneyim robotuna yol gösterebilir.</small></span><button aria-label="Sonraki bulmacaya geç" onClick={() => { const next = LEVELS[LEVELS.findIndex(l => l.id === (game.level.sourceLevelId ?? game.level.id)) + 1]; if (next) changeLevel(next); else setPage('curriculum'); }}><ArrowRight size={20}/></button></div>}</div>
              <WorkshopToolbar level={game.level} levels={LEVELS} chapters={CHAPTERS} disabled={trainingBusy || evaluating || !loaded} running={running} onLevel={changeLevel} onSimilar={changeToSimilarLevel} onOriginal={game.level.variantKind ? () => changeLevel(lesson.current) : undefined} onRestartRobot={runRobotFromStart}/>
              <div className="world-stats"><span><i className="stat-dot"/> {game.moves} <small>HAMLE</small></span><span><Check size={14}/> {progress.completed}/{progress.total} <small>HEDEF</small></span><span><GraduationCap size={15}/> {samples.filter(s => s.levelId === game.level.id && s.accepted).length} <small>ÖRNEK</small></span><button onClick={() => changeLevel(gameRef.current.level)} aria-label="Bulmacayı sıfırla"><RotateCcw size={15}/> Baştan</button></div>
              <div className="control-desk"><div className="control-intro"><span className="eyebrow small">BİR HAREKET GÖSTER</span><strong>Öğretmenin en güzel yolu,<br/>birlikte denemek.</strong><small>Yön tuşları / WASD · Etkileşim E</small></div><div className="dpad">{[0,3,2,1].map(action => <button key={action} aria-label={ACTION_NAMES[action]} data-action={action} className={`direction key-${action} ${lastKey === action ? 'pressed' : ''}`} disabled={trainingBusy || replayAt !== null} onPointerDown={e => { e.preventDefault(); if (runningRef.current) stopRobot(); act(action as Action); }} onClick={e => { if (e.detail === 0) { if (runningRef.current) stopRobot(); act(action as Action); } }}>{action === 0 ? <ArrowUp/> : action === 1 ? <ArrowRight/> : action === 2 ? <ArrowDown/> : <ArrowLeft/>}</button>)}<span className="dpad-center"/></div><button className={`interact-key ${lastKey === 4 ? 'pressed' : ''}`} aria-label="Etkileşim" disabled={trainingBusy || replayAt !== null} onPointerDown={e => { e.preventDefault(); if (runningRef.current) stopRobot(); act(4); }} onClick={e => { if (e.detail === 0) { if (runningRef.current) stopRobot(); act(4); } }}><span>E</span><small>ETKİLEŞİM</small></button><div className="key-monitor"><span>ANLIK GİRDİ</span><div>{[0,1,2,3,4,5].map(action => <i key={action} className={lastKey === action ? 'lit' : ''}>{ACTION_KEYS[action]}</i>)}</div><small>{lastKey < 0 ? 'Birlikte bir adım atın' : ACTION_NAMES[lastKey]}</small></div></div>
              <RoomGuide level={game.level} onWait={() => { stopRobot(); act(5); }} disabled={trainingBusy || replayAt !== null}/>
            </section>
            <aside className="mind-column"><section className="mind-card"><div className="card-heading"><span><BrainCircuit size={17}/> Bir zihnin içinden</span><button className="icon-button" aria-label="Beyni büyüt" onClick={() => setShowBrain(true)}><Maximize2 size={15}/></button></div><div className="brain-stage"><BrainCanvas network={network.current} trace={visibleTrace} running={running} suspended={trainingBusy} compact/><div className="brain-label"><span className="status-dot"/> {trainingBusy ? 'YENİ BAĞLAR KURULUYOR' : running ? 'CANLI KARAR AKIŞI' : 'CANLI MODEL GÖRÜNÜMÜ'}</div></div><div className="brain-legend"><span><i/>Nöron etkinliği</span><span><i/>Sinyal katkısı</span></div><div className="brain-numbers"><div><strong>96</strong><span>GRU BELLEK HÜCRESİ</span></div><div><strong>{network.current.parameterCount.toLocaleString('tr')}</strong><span>PARAMETRE</span></div><div><strong>6</strong><span>EYLEM</span></div></div><button className="text-link" onClick={() => setShowBrain(true)}>Zihni yakından incele <ArrowRight size={14}/></button></section>
              <section className="learning-card"><div className="card-heading"><span><Sparkles size={17}/> Öğrenme yolculuğu</span><span className="version-tag">v{revision}</span></div><div className="learning-count"><strong>{accepted.length}</strong><span>senin gösterdiğin<br/>öğrenme örneği</span><button className="icon-button" onClick={() => setShowSamples(true)} aria-label="Eğitim örneklerini düzenle"><Settings2 size={16}/></button></div><div className="learning-track"><i style={{ width: `${Math.min(accepted.length / 60 * 100, 100)}%` }}/></div><p>{metrics ? `Son eğitimde ${metrics.samples} çeşitlendirilmiş örneğe %${Math.round(metrics.accuracy * 100)} uyum sağladı. Yeni bir durumda neler yapacağını keşfet.` : 'Her gösterdiğin çözüm, robotunun dünyasını biraz daha genişletir.'}</p><div className="learning-note"><ShieldCheck size={14}/><span>Eğitim tamamen cihazında gerçekleşir.</span></div></section>
              <button className="surprise-card" onClick={() => { const seed = crypto.getRandomValues(new Uint32Array(1))[0]; changeLevel(generateChallenge(seed)); notify('Yeni bir düzen hazır. Öğrendiklerini buraya taşıyabilir misin?'); }}><span className="surprise-icon"><Sparkles size={22}/></span><span><strong>Biraz sürprize ne dersin?</strong><small>Yeni bir düzende birlikte düşünün.</small></span><ArrowRight size={18}/></button>
            </aside>
          </div>
          <TransferPanel report={transferReport} busy={evaluating} disabled={trainingBusy || !loaded} onEvaluate={testTransfer} onCancel={() => abortEvaluation.current?.abort()}/>
          <section className="training-bar"><div className="training-status"><span className={`training-orb ${trainingBusy ? 'working' : ''}`}><BrainCircuit size={22}/></span><div><strong>{trainingBusy ? 'Deneyimler öğrenmeye dönüşüyor…' : metrics ? `${name}, senden öğreniyor.` : 'Birlikte ilk bağlantıyı kurun.'}</strong><small>{trainingBusy && training ? `${training.epoch}/${training.totalEpochs} tur · kayıp ${training.loss.toFixed(3)}` : `${accepted.length} seçili örnek · ${saveState.toLocaleLowerCase('tr')}`}</small></div></div>{trainingBusy ? <><div className="training-meter"><i style={{ width: `${training ? training.epoch / training.totalEpochs * 100 : 0}%` }}/></div><button className="button button-outline" onClick={() => abortTraining.current?.abort()}><Pause size={15}/> Durdur</button></> : <div className="training-actions"><button className={`button button-outline ${running ? 'running-button' : ''}`} onClick={runRobot} disabled={evaluating || !loaded}>{running ? <Pause size={16}/> : <Play size={16}/>} {running ? 'Robotu durdur' : 'Robotu izle'}</button><button className="button button-primary" disabled={accepted.length < 2 || evaluating || !loaded} onClick={train}><BrainCircuit size={17}/> Robotuna öğret <span>{accepted.length}</span></button></div>}</section>
          {frames.length > 0 && <section className="replay-strip"><button onClick={() => { stopRobot(); setReplayAt(replayAt === null ? frames.length - 1 : null); }}><BookOpen size={15}/>{replayAt === null ? 'Hamleleri incele' : 'Canlı görünüme dön'}</button><input aria-label="Tekrar hamlesi" type="range" min="0" max={Math.max(0, frames.length - 1)} value={replayAt ?? frames.length - 1} onChange={e => { stopRobot(); setReplayAt(Number(e.target.value)); }}/><span>{(replayAt ?? frames.length - 1) + 1}/{frames.length}</span>{replayAt !== null && <button onClick={() => { const frame = frames[replayAt]; humanEpisode.current = null; network.current.setMemory(frame.memoryAfter); gameRef.current = frame.after; history.current = frames.slice(0,replayAt+1).map(f => f.action).slice(-16); setGame(frame.after); setFrames(previous => previous.slice(0,replayAt+1)); setReplayAt(null); }}>Buradan öğret <ArrowRight size={14}/></button>}</section>}
          <div className="bottom-note"><span><span className="status-dot"/> SENİN TARZIN. ONUN KEŞİFLERİ.</span><span>Her bulmacanın birden fazla hikâyesi var.</span></div>
        </>}

        {page === 'curriculum' && <><div className="page-heading"><div><div className="eyebrow"><span/> {LEVELS.length} DURAK, SAYISIZ OLASILIK</div><h1>Merakın bir <em>haritası.</em></h1><p>Her oda yeni bir ilişki. Her çözüm robotuna anlatacağın bir hikâye.</p></div><button className="button button-outline" onClick={() => changeLevel(generateChallenge(crypto.getRandomValues(new Uint32Array(1))[0]))}><Sparkles size={16}/> Yeni düzen oluştur</button></div>{CHAPTERS.map((chapter, i) => <section className="chapter-section" key={chapter}><div className="chapter-heading"><span>0{i+1}</span><div><small>BÖLÜM {i+1}</small><h2>{chapter}</h2></div><span>{LEVELS.filter(l => l.chapter === i+1 && completed[l.id] !== undefined).length}/8 KEŞİF</span></div><div className="level-grid">{LEVELS.filter(l => l.chapter === i+1).map((level,index) => <button className={`level-card chapter-${i} ${completed[level.id] !== undefined ? 'complete' : ''}`} key={level.id} onClick={() => changeLevel(level)}><div className="level-art"><div className="mini-floor"/>{[0,1,2,3,4].map(n => <i key={n} className={`mini-block b${n}`} style={{ '--offset': `${(index%3)*4}px` } as React.CSSProperties}/>)}<span>{completed[level.id] !== undefined ? <Check size={17}/> : String(index+1).padStart(2,'0')}</span><div className="mini-light"/></div><div className="level-copy"><small>{level.difficulty === 1 ? 'KEŞİF' : level.difficulty === 2 ? 'BAĞLANTI' : 'USTALIK'} · {level.par} HEDEF HAMLE</small><h3>{level.title}</h3><p>{level.subtitle}</p><span>{completed[level.id] !== undefined ? `${completed[level.id]} hamlede keşfedildi` : 'Kendi yolunu bul'} <ArrowRight size={14}/></span></div></button>)}</div></section>)}</>}

        {page === 'arena' && <><div className="page-heading"><div><div className="eyebrow"><span/> AYNI KOŞULLAR, FARKLI ZİHİNLER</div><h1>Öğrendiklerin <em>buluşsun.</em></h1><p>Robotunu görülmemiş bulmacalarda diğer oyuncuların modelleriyle yarıştır.</p></div><span className="fairness-badge"><ShieldCheck size={16}/> Eşit model mimarisi</span></div><div className="arena-layout"><section className="arena-hero"><div className="arena-orbits"><span/><span/><span/><BrainCircuit size={76}/></div><div className="eyebrow">GÖRÜLMEMİŞ KOŞULLAR</div><h2>Bir çözümden<br/>daha fazlası.</h2><p>Aynı nöronlar, aynı karar bütçesi, aynı bulmacalar. Robotunun farkını ona öğrettiklerin belirler.</p><div className="arena-rules"><span><Check size={14}/> Sunucuda gerçek model çalıştırma</span><span><Check size={14}/> Çoklu problem değerlendirmesi</span><span><Check size={14}/> Telefona ve bağlantı hızına bağlı olmayan sonuç</span></div><button className="button button-primary" disabled={arenaBusy || !online} onClick={submitArena}><Upload size={16}/>{arenaBusy ? 'Değerlendiriliyor…' : `${name} modelini gönder`}</button></section><section className="leaderboard"><div className="card-heading"><span><Trophy size={18}/> Arena sonuçları</span><button className="icon-button" aria-label="Sonuçları yenile" onClick={refreshArena} disabled={arenaBusy}><RotateCcw size={16}/></button></div>{entries.length ? <div className="leaderboard-list">{entries.map((entry,index) => <div className="leaderboard-row" key={entry.id}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{entry.name}</strong><small>{entry.modelHash.slice(0,10)} · sunucuda doğrulandı</small></div><b>{entry.solved}/{entry.total}<small>{entry.moves} hamle</small></b></div>)}</div> : <div className="empty-state"><Globe2 size={39}/><h3>Yeni bir karşılaşmaya yer var.</h3><p>Arena servisine bağlanınca gerçek oyuncuların sunucuda hesaplanan sonuçları burada görünür.</p><button className="button button-outline" onClick={refreshArena} disabled={arenaBusy}>Arenaya bağlan <ArrowRight size={15}/></button></div>}<p className="arena-status" role="status">{arenaStatus || 'Çevrimdışı eğitim her zaman kullanılabilir.'}</p><details className="server-settings"><summary>Arena bağlantısı <ChevronDown size={14}/></summary><label>Sunucu adresi<input value={arenaUrl} onChange={e => { setArenaUrl(e.target.value); localStorage.setItem('noema-arena-url',e.target.value); }} placeholder="https://arena.example.com"/></label><small>Aynı sunucudaki oyuncular ortak sonuç tablosunu paylaşır.</small></details></section></div></>}

        {page === 'journal' && <><div className="page-heading"><div><div className="eyebrow"><span/> BİR ZİHNİN BÜYÜME HİKÂYESİ</div><h1>Her deneyim <em>bir iz.</em></h1><p>Senin öğrettiklerin, birlikte keşfettikleriniz.</p></div><button className="button button-outline" onClick={exportModel}><Download size={16}/> Modelini sakla</button></div><div className="journal-stats">{[[String(canonicalCompleted),'KEŞFEDİLEN BULMACA'],[String(accepted.length),'SEÇİLİ EĞİTİM ÖRNEĞİ'],[String(revision),'MODEL SÜRÜMÜ'],[metrics ? `%${Math.round(metrics.accuracy*100)}` : '—','SON EĞİTİM UYUMU']].map(([value,label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div><section className="journal-card"><div className="card-heading"><span><BookOpen size={17}/> Keşif günlüğü</span><span>{canonicalCompleted} kayıt</span></div>{canonicalCompleted ? LEVELS.filter(l => completed[l.id] !== undefined).map(level => <div className="journal-row" key={level.id}><span className="journal-check"><Check size={19}/></span><div><h3>{level.title}</h3><p>{completed[level.id]} hamlede kendi yolunu buldun.</p></div><button className="button button-outline" onClick={() => changeLevel(level)}>Yeniden keşfet <ArrowRight size={14}/></button></div>) : <div className="empty-state"><Sparkles size={38}/><h3>İlk hikâyen seni bekliyor.</h3><p>Bir bulmacayı çözerek keşif günlüğünün ilk sayfasını aç.</p><button className="button button-primary" onClick={() => setPage('workshop')}>Atölyeye dön <ArrowRight size={15}/></button></div>}</section></>}
      </main>
    </div>
    <nav className="mobile-nav">{NAV.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { stopRobot(); setPage(item.id); }}><item.icon size={20}/><span>{item.label}</span></button>)}</nav>
    {toast && <div className="toast" role="status"><Sparkles size={17}/>{toast}<button onClick={() => setToast('')} aria-label="Bildirimi kapat"><X size={15}/></button></div>}
    {(showHelp || showSettings || showBrain || showSamples) && <div className="modal-backdrop" onClick={() => { setShowHelp(false); setShowSettings(false); setShowBrain(false); setShowSamples(false); }}><section className={`modal ${showBrain ? 'brain-modal' : ''}`} role="dialog" aria-modal="true" aria-label={showBrain ? 'Canlı beyin görünümü' : showSamples ? 'Eğitim örnekleri' : showSettings ? 'Ayarlar' : 'Nasıl oynanır'} onClick={e => e.stopPropagation()}><button className="modal-close icon-button" aria-label="Kapat" onClick={() => { setShowHelp(false); setShowSettings(false); setShowBrain(false); setShowSamples(false); }}><X size={20}/></button>
      {showHelp && <><div className="eyebrow">NOEMA'YA HOŞ GELDİN</div><h2>Birlikte düşünmeyi öğrenin.</h2><p>Robotunun öğretmeni sensin. Tek bir doğru yol aramıyorsunuz; kendi yaklaşımınızı keşfediyorsunuz.</p><div className="help-steps">{[['01','Sen çöz','Yön tuşlarıyla ilerle. E veya etkileşim düğmesiyle önündeki nesneyi al, bırak ya da mekanizmayı çalıştır.'],['02','Robotuna öğret','Hamlelerin cihazında örneğe dönüşür. İstemediklerini çıkarıp Robotuna öğret düğmesiyle gerçek modeli eğit.'],['03','Onun yolunu izle','Robotu izle bulunduğun yerden devam eder. Haritanın altındaki Baştan izle aynı bölümü başlangıçtan oynatır; Benzer bölüm ise bir engeli değiştirir. Bölüm seçip istediğin yere atlayabilirsin.'],['04','Yeni olasılıklara açıl','7 koşulda sına ile öğrenme ile ezberi karşılaştır. Buzda kaymayı, bant yönlerini ve sıralı anahtarları keşfet. Robotun bölüm değişince sıfırlanmaz.']].map(([number,title,text]) => <div key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div><button className="button button-primary" onClick={() => setShowHelp(false)}>Keşfe başla <ArrowRight size={16}/></button></>}
      {showSettings && <><div className="eyebrow">SANA AİT BİR ATÖLYE</div><h2>Küçük ayarlar, iyi deneyimler.</h2><label className="settings-label">Robotunun adı<input value={name} maxLength={24} onChange={e => setName(e.target.value.replace(/[<>]/g,''))}/></label><div className="settings-row"><span><Volume2 size={18}/> Ses efektleri</span><button className={`toggle ${audio ? 'on' : ''}`} aria-label="Ses efektlerini değiştir" aria-pressed={audio} onClick={() => setAudio(!audio)}><i/></button></div><div className="settings-row"><span><Sparkles size={18}/> Görsel kalite</span><select value={quality} onChange={e => setQuality(e.target.value as 'high'|'balanced')}><option value="high">Yüksek</option><option value="balanced">Dengeli</option></select></div><div className="settings-row"><span><Sparkles size={18}/> Hava olayları</span><select aria-label="Hava olayları" value={weather} onChange={e => setWeather(e.target.value as WeatherMode)}><option value="auto">Doğal döngü</option><option value="clear">Açık hava</option><option value="rain">Yağmur</option></select></div><div className="settings-row"><span><ShieldCheck size={18}/> Model sözleşmesi</span><small>{MODEL_INPUTS} → 96 → GRU96 → 64 → 6</small></div><div className="settings-actions"><button className="button button-outline" onClick={exportModel}><Download size={16}/> Modeli dışa aktar</button><button className="button button-outline" disabled={trainingBusy || evaluating} onClick={() => importInput.current?.click()}><Upload size={16}/> Model yükle</button></div><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={e => { void importModel(e.target.files?.[0]); e.target.value=''; }}/><p className="fine-print">Örneklerin ve robotun bu cihazda saklanır. Eğitim için internet bağlantısı gerekmez.</p></>}
      {showBrain && <><div className="eyebrow">GERÇEK MODEL · CANLI SİNYALLER</div><h2>Bir zihnin içinden.</h2><div className="expanded-brain"><BrainCanvas network={network.current} trace={visibleTrace} running={running} suspended={trainingBusy}/></div><p className="fine-print">96 GRU hücresi bölüm boyunca bilgiyi taşır. Parlaklık etkinliği, bağlar gerçek sinyal katkısını gösterir. Bu değerler hesap akışını görünür kılar; düşüncelerin kesin açıklaması değildir.</p></>}
      {showSamples && <><div className="eyebrow">NEYİ ÖĞRENECEĞİNE SEN KARAR VER</div><h2>Deneyim koleksiyonu.</h2><p>Bir denemeyi örnek almak istemiyorsan seçimini kaldır. Son 80 örnek gösteriliyor.</p><div className="sample-list">{samples.slice(-80).reverse().map(sample => <label key={sample.id}><input type="checkbox" checked={sample.accepted} onChange={e => setSamples(previous => previous.map(s => s.id === sample.id ? { ...s, accepted: e.target.checked } : s))}/><span className="sample-key">{ACTION_KEYS[sample.action]}</span><span>{ACTION_NAMES[sample.action]}<small>{LEVELS.find(l => l.id === sample.levelId)?.title ?? 'Yeni düzen'}</small></span></label>)}{!samples.length && <p>İlk hamlenle koleksiyonun başlayacak.</p>}</div><div className="settings-actions"><button className="button button-outline" onClick={() => setSamples(previous => previous.map(s => ({...s,accepted:true})))}>Tümünü seç</button><button className="button button-outline" onClick={() => { setSamples(previous => previous.map(s => ({...s,accepted:false}))); notify('Örnekler silinmedi; eğitim seçiminden çıkarıldı.'); }}>Seçimi kaldır</button></div></>}
    </section></div>}
  </div>;
}
