import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Activity, ArrowDownRight, ArrowRight, AudioLines, Box, BrainCircuit, Check, ChevronRight, CircleHelp, CloudSun, CloudRain, Crosshair, Expand, Gamepad2, Layers3, LoaderCircle, Maximize2, MoveUpRight, Pause, Play, Radio, RotateCcw, ScanLine, Shield, Sparkles, Sun, Swords, Target, Trophy, Volume2, VolumeX, X, Zap } from 'lucide-react';
import { createDuel, setStrategy, shotSpeedForPower, SHOT_COOLDOWN, startDuel, stepDuel, togglePause } from './engine';
import { createDuelModel, DUEL_OUTPUTS, DUEL_PARAMETER_COUNT, encodeDuelAction, encodeDuelObservation, getDuelParameters, getDuelTrace, isDuelModel, predictDuel, previewDuel, resetDuelMemory, trainDuel } from './learning';
import type { DuelModel, DuelSample } from './learning';
import { DuelScene } from './DuelScene';
import { COURT, LAYOUTS, STRATEGIES } from './types';
import type { CourtLayout, DuelRobot, DuelState, ManualInput, Side, Strategy, Vec2 } from './types';
import { Joystick } from './Joystick';
import { emptyRobotControl, RobotControlMonitor } from './RobotControlMonitor';
import type { RobotControlSnapshot } from './RobotControlMonitor';
import { TrainingDetails } from './TrainingDetails';
import type { TrainingRun } from './TrainingDetails';
import { OnlinePages } from './OnlinePages';
import { DuelAmbienceAudio } from './ambienceAudio';
import type { AtmosphereSnapshot, WeatherMode } from '../render/weather';
import { readRecord, writeRecord } from '../lib/storage';
import { saveModelFile } from '../lib/platform';
import { usePlayableFullscreen } from '../lib/playableFullscreen';
import { setArenaFullscreen } from '../lib/arenaFullscreen';
import { Capacitor } from '@capacitor/core';
import { BrainCanvas } from '../components/BrainCanvas';
import type { ActivationTrace } from '../ml/network';
import './duel.css';
import './controls.css';
import './fullscreen.css';
import './theme.css';
import './app-shell.css';
import './arena-training.css';

declare global {
  interface Window { __DUEL__?: { state: () => DuelState; input: () => ManualInput; control: () => RobotControlSnapshot; advance: (seconds: number) => void; pauseSimulation: (paused: boolean) => void; pausePresentation: (paused: boolean) => void; atmosphere: () => AtmosphereSnapshot | undefined; advanceAtmosphere: (seconds: number) => void; ambienceAudio: () => ReturnType<DuelAmbienceAudio['getSnapshot']> | undefined } }
}

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const phaseNames = { ready: 'Maç bekleniyor', running: 'Maç sürüyor', paused: 'Duraklatıldı', finished: 'Maç tamamlandı' };
const teamNames = ['ATLAS', 'KOR'];
const LEARNING_KEY = 'noema-duel-gru96-v1';
const MOTOR_NAMES = ['Hareket X', 'Hareket Z', 'Nişan açısı', 'Yedek çıkış', 'Ateş', 'Siper'];
const MAX_SAMPLES = 8000;
type AppPage = 'workshop' | 'arena' | 'rankings';
const PAGES = [{ id: 'workshop', label: 'Atölye', icon: Gamepad2 }, { id: 'arena', label: 'Online Arena', icon: Swords }, { id: 'rankings', label: 'Sıralama', icon: Trophy }] as const;

function RobotGlyph({ side = 0 }: { side?: Side }) {
  return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={`robot-glyph team-${side}`}>
    <path d="M24 6v5M21 6h6M9 23H6v10h4M39 23h3v10h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <rect x="10" y="12" width="28" height="25" rx="8" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="1.5" />
    <rect x="15" y="19" width="18" height="9" rx="3" fill="currentColor" fillOpacity=".22" />
    <path d="M19 22v3m10-3v3m-9 7h8M17 38v4m14-4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

function TeamScore({ robot }: { robot: DuelRobot }) {
  return <div className={`team-score team-${robot.id}`}>
    <div className="team-avatar"><RobotGlyph side={robot.id} /></div>
    <div className="team-score-body"><div className="team-score-name"><strong>{teamNames[robot.id]}</strong><span>{robot.id === 0 ? 'SİYAN TAKIM' : 'TURUNCU TAKIM'}</span></div>
      <div className="health-track" role="progressbar" aria-label={`${teamNames[robot.id]} canı`} aria-valuemin={0} aria-valuemax={robot.maxHp} aria-valuenow={Math.ceil(robot.hp)}><div style={{ width: `${Math.max(0, robot.hp / robot.maxHp * 100)}%` }} /></div>
      <div className="team-score-meta"><span><i />{robot.id === 0 ? 'Öğrenen robot' : STRATEGIES[robot.strategy].label}</span><span><b data-testid={`robot-hp-${robot.id}`}>{Math.max(0, Math.ceil(robot.hp))}</b> / {robot.maxHp} CAN</span></div>
    </div>
  </div>;
}

function ManualControls({ input, disabled, cooldown, queued, carrying }: { input: RefObject<ManualInput>; disabled: boolean; cooldown: number; queued: boolean; carrying: boolean }) {
  return <section className="manual-panel" aria-label="Manuel robot kontrolleri">
    <div className="manual-instructions"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> hareket</span><span><Crosshair size={14} /> sağ tarafa dokunarak ateş et</span><span><kbd>E</kbd> siper al / bırak</span></div>
    <div className="touch-controls">
      <div className="manual-actions">
        <div className="manual-action-buttons"><button className="touch-cover" disabled={disabled} onClick={() => { input.current.interact = true; }}><Box size={18} /> Al / bırak</button><div className="tap-to-fire-hint" data-testid="arena-tap-hint"><span><Crosshair size={15} /> Sağ tarafa dokun</span><small data-testid="shot-cooldown" role="status">{carrying ? 'Önce siperi bırak' : queued ? 'Atış sırada' : cooldown > .01 ? `${cooldown.toFixed(1)} sn bekle` : 'Atış hazır'}</small><div className="shot-reload-track" aria-hidden="true"><span style={{ width: `${(1 - Math.min(1, cooldown / SHOT_COOLDOWN)) * 100}%` }} /></div></div></div>
      </div>
    </div>
  </section>;
}

export default function DuelApp() {
  const [trainingOpen, setTrainingOpen] = useState(false);
  const trainingOpenRef = useRef(false);
  const trainingToggle = useRef<HTMLButtonElement>(null);
  const trainingPopover = useRef<HTMLDivElement>(null);
  const closeTraining = useCallback((restoreFocus = true) => {
    if (!trainingOpenRef.current) return false;
    trainingOpenRef.current = false; setTrainingOpen(false);
    if (restoreFocus) trainingToggle.current?.focus({ preventScroll: true });
    return true;
  }, []);
  const [page, setPage] = useState<AppPage>('workshop');
  const pageRef = useRef<AppPage>('workshop');
  const [weather, setWeather] = useState<WeatherMode>('auto');
  const [climate, setClimate] = useState<AtmosphereSnapshot>({ mode: 'auto', phase: 'cloudy', rain: 0, wind: .4, cloudCover: .35, wetness: 0, sunlight: .7 });
  const climateRef = useRef(climate);
  const ambienceAudio = useRef<DuelAmbienceAudio | null>(null);
  const ambienceVisible = useRef(true);
  const state = useRef<DuelState>(null!);
  if (!state.current) state.current = createDuel();
  const [view, setView] = useState<DuelState>(() => structuredClone(state.current));
  const canvasHost = useRef<HTMLDivElement>(null);
  const { host: arenaHost, active: full, activeRef: fullRef, open: openFullscreen, close: closeFullscreen } = usePlayableFullscreen({ documentRoot: true, onEscape: closeTraining });
  const scene = useRef<DuelScene | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [camera, setCamera] = useState<'perspective' | 'overhead'>('perspective');
  const [manual, setManual] = useState(true);
  const [sampleCount, setSampleCount] = useState(0);
  const [trained, setTrained] = useState(false);
  const [trainProgress, setTrainProgress] = useState<{ epoch: number; epochs: number; loss: number } | null>(null);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const trainingBusyRef = useRef(false);
  const [trainingEpochs, setTrainingEpochs] = useState(1);
  const [learningNotice, setLearningNotice] = useState('');
  const [recording, setRecording] = useState(true);
  const [trainingLoss, setTrainingLoss] = useState<number | null>(null);
  const [trainingRun, setTrainingRun] = useState<TrainingRun | null>(null);
  const [learningReady, setLearningReady] = useState(false);
  const learningReadyRef = useRef(false);
  const samples = useRef<DuelSample[]>([]);
  const model = useRef<DuelModel | undefined>(undefined);
  if (!model.current) model.current = createDuelModel();
  const [brainTrace, setBrainTrace] = useState<ActivationTrace>(() => previewDuel(model.current!, state.current));
  const [brainOpen, setBrainOpen] = useState(false);
  const lastBrainPublish = useRef(0);
  const modelFile = useRef<HTMLInputElement>(null);
  const episodeNumber = useRef(0);
  const episode = useRef({ id: `${Date.now()}-0`, first: true });
  const recordingRef = useRef(true);
  const trainAbort = useRef<AbortController | null>(null);
  const nextSample = useRef(0);
  const lastDemonstrationFire = useRef(false);
  const learnedInput = useRef<ManualInput>({ move: { x: 0, z: 0 }, aim: { x: 8, z: 0 }, power: 1, fire: false, interact: false });
  const robotControl = useRef<RobotControlSnapshot>(emptyRobotControl());
  const [controlView, setControlView] = useState<RobotControlSnapshot>(emptyRobotControl);
  const nextInference = useRef(0);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<Side>(0);
  const [help, setHelp] = useState(false);
  const [sound, setSound] = useState(false);
  const speedRef = useRef(1);
  const manualRef = useRef(true);
  const soundRef = useRef(false);
  const keys = useRef(new Set<string>());
  const joystick = useRef<Vec2>({ x: 0, z: 0 });
  const [controlReset, setControlReset] = useState(0);
  const heldFire = useRef(false);
  const pendingShot = useRef<Vec2 | null>(null);
  const input = useRef<ManualInput>({ move: { x: 0, z: 0 }, aim: { x: 6, z: 0 }, power: 1, fire: false, interact: false });
  const audio = useRef<AudioContext | null>(null);
  const lastAudioEvent = useRef(0);
  const lastPublish = useRef(0);
  const seed = useRef(42);
  const simulationPausedForTesting = useRef(false);

  const syncAmbience = useCallback(() => {
    ambienceAudio.current?.update({ rain: climateRef.current.rain, wind: climateRef.current.wind, enabled: soundRef.current, visible: ambienceVisible.current && !document.hidden });
  }, []);
  const receiveAtmosphere = useCallback((snapshot: AtmosphereSnapshot) => {
    climateRef.current = snapshot; setClimate(snapshot); syncAmbience();
  }, [syncAmbience]);

  const updateMovement = useCallback(() => {
    const held = keys.current;
    const x = joystick.current.x + Number(held.has('d') || held.has('arrowright')) - Number(held.has('a') || held.has('arrowleft'));
    const z = joystick.current.z + Number(held.has('s') || held.has('arrowdown')) - Number(held.has('w') || held.has('arrowup'));
    const magnitude = Math.max(1, Math.hypot(x, z));
    input.current.move = { x: x / magnitude, z: z / magnitude };
  }, []);
  const moveJoystick = useCallback((move: Vec2) => { joystick.current = move; updateMovement(); }, [updateMovement]);
  const setFiring = useCallback((firing: boolean) => {
    heldFire.current = firing;
    input.current.fire = manualRef.current && (firing || pendingShot.current !== null);
  }, []);
  const clearControls = useCallback(() => {
    keys.current.clear(); joystick.current = { x: 0, z: 0 }; heldFire.current = false; pendingShot.current = null;
    input.current.move = { x: 0, z: 0 }; input.current.fire = false; input.current.interact = false;
    lastDemonstrationFire.current = false;
    setControlReset(value => value + 1);
  }, []);

  const toggleTraining = useCallback(() => {
    if (trainingOpenRef.current) { closeTraining(); return; }
    clearControls(); trainingOpenRef.current = true; setTrainingOpen(true);
  }, [clearControls, closeTraining]);
  useEffect(() => {
    if (!trainingOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || trainingPopover.current?.contains(target) || trainingToggle.current?.contains(target)) return;
      closeTraining(false); clearControls();
      // Dismissing the panel by touching the field must not also request a shot.
      if (target instanceof Element && target.closest('.duel-canvas, .movement-zone')) { event.preventDefault(); event.stopPropagation(); }
    };
    const closeButton = trainingPopover.current?.querySelector<HTMLButtonElement>('[data-testid="training-close"]');
    closeButton?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [trainingOpen, clearControls, closeTraining]);

  const publish = useCallback(() => {
    scene.current?.update(state.current);
    setView(structuredClone(state.current));
    setControlView(robotControl.current);
    setSampleCount(samples.current.length);
    const now = performance.now();
    if (model.current && now - lastBrainPublish.current >= (window.innerWidth < 700 ? 400 : 200)) {
      lastBrainPublish.current = now;
      setBrainTrace(manualRef.current ? previewDuel(model.current, state.current) : getDuelTrace(model.current) ?? previewDuel(model.current, state.current));
    }
  }, []);

  const queueShot = useCallback((point: Vec2) => {
    if (!manualRef.current || state.current.phase !== 'running' || state.current.robots[0].carrying) return;
    pendingShot.current = { ...point };
    input.current.aim = { ...point };
    input.current.fire = true;
    publish();
  }, [publish]);

  const recordSample = useCallback((force = false) => {
    if (state.current.phase !== 'running' || !manualRef.current || !recordingRef.current || (!force && state.current.time < nextSample.current)) return;
    samples.current.push({ input: encodeDuelObservation(state.current), output: encodeDuelAction(state.current, input.current), episodeId: episode.current.id, sequenceStart: episode.current.first });
    episode.current.first = false;
    if (samples.current.length > MAX_SAMPLES) samples.current.splice(0, samples.current.length - MAX_SAMPLES);
    nextSample.current = state.current.time + .1;
  }, []);

  const advanceSimulation = useCallback((dt: number) => {
    updateMovement();
    if (pendingShot.current) input.current.aim = { ...pendingShot.current };
    input.current.fire = manualRef.current && (heldFire.current || pendingShot.current !== null);
    recordSample(input.current.interact || (input.current.fire && !lastDemonstrationFire.current));
    lastDemonstrationFire.current = input.current.fire;
    if (!manualRef.current && model.current && state.current.phase === 'running' && state.current.time >= nextInference.current) {
      learnedInput.current = predictDuel(model.current, state.current);
      nextInference.current = state.current.time + .1;
    }
    const shotsBefore = state.current.robots[0].shots;
    const carryingBefore = state.current.robots[0].carrying;
    const timeBefore = state.current.time;
    stepDuel(state.current, dt, manualRef.current ? input.current : learnedInput.current);
    if (!manualRef.current && state.current.time > timeBefore) {
      const command = learnedInput.current;
      robotControl.current = {
        command: { ...command, move: { ...command.move }, aim: { ...command.aim } }, hasDecision: true,
        shotAt: state.current.robots[0].shots > shotsBefore ? state.current.time : robotControl.current.shotAt,
        // A carried crate being destroyed is not a successful al/bırak command.
        coverAt: state.current.robots[0].carrying !== carryingBefore ? (state.current.robots[0].carrying !== null || state.current.crates.some(crate => crate.id === carryingBefore && crate.hp > 0) ? state.current.time : null) : robotControl.current.coverAt,
      };
    }
    if (pendingShot.current && state.current.robots[0].shots > shotsBefore) {
      pendingShot.current = null;
      input.current.fire = heldFire.current;
      if (!heldFire.current) lastDemonstrationFire.current = false;
    }
    if (!manualRef.current && model.current && state.current.phase === 'running') {
      state.current.robots[0].decision.action = state.current.robots[0].carrying ? 'Öğrendiği siperi taşıyor' : learnedInput.current.fire ? 'Öğrendiği atışı yapıyor' : Math.hypot(learnedInput.current.move.x, learnedInput.current.move.z) > .15 ? 'Öğrendiği yolda ilerliyor' : 'Durumu değerlendiriyor';
      state.current.robots[0].decision.reason = 'Hareket, nişan, ateş ve siper kararlarını eğittiğin sinir ağının çıktıları belirliyor. Atışlar %100 güçte.';
    }
    input.current.interact = false;
  }, [updateMovement, recordSample]);

  const saveLearning = useCallback(() => {
    if (!learningReadyRef.current) return;
    void writeRecord(LEARNING_KEY, { model: model.current, samples: samples.current.slice(), loss: trainingLoss }).catch(() => setLearningNotice('Cihaz kaydı yapılamadı. Bu oturumdaki örneklerin ve modelin bellekte tutuluyor.'));
  }, [trainingLoss]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await readRecord<{ model?: unknown; samples?: DuelSample[]; loss?: number }>(LEARNING_KEY);
        if (!active) return;
        if (saved) {
          const expected = encodeDuelObservation(state.current).length;
          if (Array.isArray(saved.samples)) samples.current = saved.samples.filter((sample: DuelSample) => sample && Array.isArray(sample.input) && sample.input.length === expected && Array.from(sample.input).every(value => Number.isFinite(value) && Math.abs(value) <= 1.000001) && Array.isArray(sample.output) && sample.output.length === DUEL_OUTPUTS && Array.from(sample.output).every((value, index) => Number.isFinite(value) && value >= (index >= 3 ? 0 : -1) && value <= 1)).slice(-MAX_SAMPLES).map(sample => ({ ...sample, output: sample.output.map((value, index) => index === 3 ? 1 : value) }));
          if (isDuelModel(saved.model)) { model.current = saved.model; setTrained(saved.model.trainedSteps > 0); setBrainTrace(previewDuel(saved.model, state.current)); }
          if (typeof saved.loss === 'number' && Number.isFinite(saved.loss)) setTrainingLoss(saved.loss);
          setSampleCount(samples.current.length);
        }
      } catch { if (active) setLearningNotice('Kayıt okunamadı. Yeni örneklerle devam edebilirsin.'); }
      finally { if (active) { learningReadyRef.current = true; setLearningReady(true); } }
    })();
    return () => { active = false; trainAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(saveLearning, 5000);
    window.addEventListener('pagehide', saveLearning);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', saveLearning); };
  }, [saveLearning]);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  const beep = useCallback((kind: string) => {
    if (!soundRef.current || !audio.current || audio.current.state !== 'running') return;
    const context = audio.current, osc = context.createOscillator(), gain = context.createGain();
    osc.type = kind === 'hit' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(kind === 'hit' ? 180 : kind === 'bounce' ? 740 : 440, context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, context.currentTime + .09);
    gain.gain.setValueAtTime(.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .1);
    osc.connect(gain); gain.connect(context.destination); osc.start(); osc.stop(context.currentTime + .11);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }, []);

  useEffect(() => {
    if (!canvasHost.current) return;
    try {
      const instance = new DuelScene(canvasHost.current, state.current, {
        onAim: point => { input.current.aim = point; },
        onTap: queueShot,
        onAtmosphere: receiveAtmosphere,
      });
      scene.current = instance;
      return () => { instance.dispose(); if (scene.current === instance) scene.current = null; };
    } catch (error) { console.error('Arena oluşturulamadı', error); setRenderError(true); }
  }, [queueShot, receiveAtmosphere]);

  useEffect(() => { scene.current?.setCamera(camera); }, [camera]);
  useEffect(() => { scene.current?.setWeather(weather); }, [weather]);
  useEffect(() => {
    ambienceVisible.current = page === 'workshop' && !trainingBusy;
    scene.current?.setPresentationPaused(!ambienceVisible.current);
    syncAmbience();
  }, [trainingBusy, page, syncAmbience]);
  useEffect(() => {
    document.addEventListener('visibilitychange', syncAmbience);
    return () => document.removeEventListener('visibilitychange', syncAmbience);
  }, [syncAmbience]);
  useEffect(() => {
    manualRef.current = manual;
    if (model.current) resetDuelMemory(model.current);
    episode.current = { id: `${Date.now()}-${++episodeNumber.current}`, first: true };
    scene.current?.setInteractive(manual);
    clearControls();
  }, [manual, clearControls]);
  useEffect(() => { if (view.phase !== 'running') clearControls(); }, [view.phase, clearControls]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  useEffect(() => {
    let frame = 0, previous = 0;
    const animate = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, .05) : 0;
      previous = now;
      if (!document.hidden && pageRef.current === 'workshop') {
        if (!import.meta.env.DEV || !simulationPausedForTesting.current) advanceSimulation(dt * speedRef.current);
        const latest = state.current.events.at(-1);
        if (latest && latest.id > lastAudioEvent.current) { lastAudioEvent.current = latest.id; beep(latest.kind); }
        if (now - lastPublish.current > 100) { lastPublish.current = now; publish(); }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const onVisibility = () => { previous = 0; clearControls(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', onVisibility); };
  }, [publish, beep, advanceSimulation, clearControls]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (pageRef.current !== 'workshop' || trainingBusyRef.current || trainingOpenRef.current) return;
      if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[role="dialog"],.brain-canvas')) return;
      const key = event.key.toLowerCase();
      if (key === ' ' && event.target instanceof HTMLElement && event.target.closest('button')) return;
      if (key === ' ' && !event.repeat) {
        event.preventDefault();
        if (manualRef.current) setFiring(true);
        else { if (state.current.phase === 'ready') { openFullscreen(); startDuel(state.current); } else togglePause(state.current); publish(); }
      }
      if (manualRef.current && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'e'].includes(key)) {
        event.preventDefault(); keys.current.add(key);
        updateMovement();
        if (key === 'e' && !event.repeat) input.current.interact = true;
      }
    };
    const up = (event: KeyboardEvent) => { keys.current.delete(event.key.toLowerCase()); updateMovement(); if (event.key === ' ') setFiring(false); };
    const blur = () => clearControls();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    window.addEventListener('resize', blur); window.addEventListener('orientationchange', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); window.removeEventListener('orientationchange', blur); };
  }, [publish, updateMovement, setFiring, clearControls, openFullscreen]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__DUEL__ = {
      state: () => structuredClone(state.current),
      input: () => structuredClone(input.current),
      control: () => structuredClone(robotControl.current),
      pauseSimulation: paused => { simulationPausedForTesting.current = paused; },
      pausePresentation: paused => scene.current?.setPresentationPaused(paused),
      atmosphere: () => scene.current?.getAtmosphere(),
      advanceAtmosphere: seconds => { for (let left = Math.min(300, Math.max(0, seconds)); left > 0; left -= .1) scene.current?.advanceAtmosphere(Math.min(left, .1)); },
      ambienceAudio: () => ambienceAudio.current?.getSnapshot(),
      advance: seconds => { for (let left = Math.min(300, Math.max(0, seconds)); left > 0; left -= 1 / 120) advanceSimulation(Math.min(left, 1 / 120)); publish(); },
    };
    return () => { delete window.__DUEL__; };
  }, [publish, advanceSimulation]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeTraining(); setHelp(false); setBrainOpen(false); } };
    window.addEventListener('keydown', escape);
    if (help || brainOpen) document.body.classList.add('duel-dialog-open');
    return () => { window.removeEventListener('keydown', escape); document.body.classList.remove('duel-dialog-open'); };
  }, [help, brainOpen, closeTraining]);
  useEffect(() => { if (help || brainOpen) { closeTraining(false); clearControls(); } }, [help, brainOpen, closeTraining, clearControls]);
  useEffect(() => {
    void setArenaFullscreen(full);
    return () => { if (full) void setArenaFullscreen(false); };
  }, [full]);
  useEffect(() => {
    if (!full || !Capacitor.isNativePlatform()) return;
    let disposed = false;
    let removeBack: (() => Promise<void>) | undefined;
    void import('@capacitor/app').then(async ({ App }) => {
      const listener = await App.addListener('backButton', () => {
        if (brainOpen) setBrainOpen(false);
        else if (help) setHelp(false);
        else closeFullscreen();
      });
      if (disposed) await listener.remove();
      else removeBack = () => listener.remove();
    });
    return () => { disposed = true; void removeBack?.(); };
  }, [full, help, brainOpen, closeFullscreen, closeTraining]);
  useEffect(() => () => { ambienceAudio.current?.dispose(); void audio.current?.close(); }, []);

  function selectPage(next: AppPage) {
    if (next === page) return;
    closeTraining(false); clearControls(); setHelp(false); setBrainOpen(false);
    if (state.current.phase === 'running') { togglePause(state.current); publish(); }
    if (full) closeFullscreen();
    pageRef.current = next; setPage(next);
  }

  function reset(layout = state.current.layout) {
    closeTraining(false);
    const strategies = state.current.robots.map(robot => robot.strategy);
    state.current = createDuel(layout, ++seed.current);
    robotControl.current = emptyRobotControl();
    strategies.forEach((strategy, side) => setStrategy(state.current, side as Side, strategy));
    clearControls();
    nextSample.current = 0; nextInference.current = 0;
    if (model.current) resetDuelMemory(model.current);
    episode.current = { id: `${Date.now()}-${++episodeNumber.current}`, first: true };
    lastAudioEvent.current = 0; publish();
  }
  function beginDuel() {
    if (renderError || trainingBusyRef.current || !learningReadyRef.current) return;
    closeTraining(false);
    if (!fullRef.current) openFullscreen();
    if (state.current.phase === 'finished') reset();
    startDuel(state.current); publish();
  }
  function useTeachingMode() { if (trainingBusyRef.current) return; setManual(true); manualRef.current = true; publish(); }
  function watchRobot() {
    if (!model.current || model.current.trainedSteps === 0 || trainingBusy) return;
    reset(); setManual(false); manualRef.current = false; nextInference.current = 0;
    learnedInput.current = predictDuel(model.current, state.current);
    beginDuel();
  }
  async function teachRobot() {
    if (samples.current.length < 16 || trainingBusyRef.current) return;
    clearControls(); trainingOpenRef.current = true; setTrainingOpen(true);
    if (state.current.phase === 'running') togglePause(state.current);
    publish(); trainingBusyRef.current = true; setTrainingBusy(true); setLearningNotice('');
    const abort = new AbortController(); trainAbort.current = abort;
    setTrainProgress({ epoch: 0, epochs: trainingEpochs, loss: 0 });
    setTrainingRun({ status: 'running', epochs: trainingEpochs, sampleCount: samples.current.length, startedAt: Date.now(), history: [] });
    try {
      const result = await trainDuel(samples.current, model.current, { epochs: trainingEpochs, signal: abort.signal, onProgress: progress => {
        setTrainProgress(progress);
        setTrainingRun(run => run ? { ...run, history: [...run.history, { epoch: progress.epoch, loss: progress.loss }] } : run);
      } });
      model.current = result.model; setTrained(true); setTrainingLoss(result.loss);
      setTrainingRun(run => run ? { ...run, status: 'complete', finishedAt: Date.now() } : run);
      try {
        await writeRecord(LEARNING_KEY, { model: result.model, samples: samples.current.slice(), loss: result.loss });
        setLearningNotice('Robotun örneklerinden öğrendi. Robotumu izle ile yeni bir maçta dene.');
      } catch { setLearningNotice('Eğitim tamamlandı; cihaz kaydı yapılamadı. Model bu oturumda kullanılabilir.'); }
    } catch (error) {
      setTrainingRun(run => run ? { ...run, status: abort.signal.aborted ? 'cancelled' : 'error', finishedAt: Date.now() } : run);
      setLearningNotice(abort.signal.aborted ? 'Eğitim durduruldu. Önceki modelin ve örneklerin korundu.' : `Eğitim tamamlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally { trainingBusyRef.current = false; setTrainingBusy(false); setTrainProgress(null); trainAbort.current = null; }
  }
  function changeStrategy(side: Side, strategy: Strategy) { setStrategy(state.current, side, strategy); publish(); }
  async function loadModel(file?: File) {
    if (!file || trainingBusy) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Model dosyası en fazla 2 MB olabilir.');
      const loaded: unknown = JSON.parse(await file.text());
      if (!isDuelModel(loaded)) throw new Error('Bu dosya 77.926 parametreli arena GRU modeliyle uyumlu değil.');
      model.current = loaded; resetDuelMemory(loaded); setTrained(loaded.trainedSteps > 0); setManual(true); reset();
      setTrainingRun(null); setTrainingLoss(null);
      setBrainTrace(previewDuel(loaded, state.current));
      void writeRecord(LEARNING_KEY, { model: loaded, samples: samples.current.slice(), loss: null }).catch(() => setLearningNotice('Model yüklendi; cihaz kaydı yapılamadı. Model bu oturumda kullanılabilir.'));
      setLearningNotice('GRU modeli yüklendi. Modeli inceleyebilir veya Robotumu izle ile deneyebilirsin.');
    } catch (error) { setLearningNotice(error instanceof Error ? error.message : 'Model yüklenemedi.'); }
    finally { if (modelFile.current) modelFile.current.value = ''; }
  }
  function changeSound() {
    const enabled = !sound;
    if (enabled) { audio.current ??= new AudioContext(); ambienceAudio.current ??= new DuelAmbienceAudio(audio.current); void audio.current.resume().then(syncAmbience); }
    soundRef.current = enabled; setSound(enabled); syncAmbience();
  }
  function fullscreen() {
    if (full) closeFullscreen();
    else openFullscreen();
  }
  const robot = view.robots[selected];
  const angle = ((Math.atan2(robot.decision.aim.z - robot.z, robot.decision.aim.x - robot.x) * 180 / Math.PI) + 360) % 360;
  const recentEvents = view.events.filter(event => event.kind !== 'shot').slice(-4).reverse();

  return <div className="duel-app" data-testid="duel-app" data-page={page} data-learning-ready={learningReady}>
    <header className="duel-topbar"><a className="duel-brand" href="./" aria-label="NOEMA Duel ana sayfa"><span className="brand-mark"><span /><span /><span /></span><strong>NOEMA<span>DUEL</span></strong></a>
      <nav aria-label="Ana menü">{PAGES.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'nav-active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => selectPage(id)}><Icon size={16} />{label}</button>)}</nav>
      <button className="icon-button app-help" aria-label="Nasıl oynanır?" onClick={() => setHelp(true)}><CircleHelp size={18} /></button>
    </header>

    <main className="duel-main" hidden={page !== 'workshop'}>
      <div className="workshop-title"><h1>Atölye</h1><small>Robotuna oynayarak öğret.</small></div>



      <div className="duel-workspace">
        <div className="duel-left">
          <section ref={arenaHost} className={`arena-panel ${full ? 'arena-fullscreen' : ''}`} aria-label="Robot düellosu">
            <div className="arena-heading"><div><span className="arena-index">{view.layout === 'classic' ? '01' : view.layout === 'ricochet' ? '02' : '03'}</span><div><h2>Karşılaşma alanı</h2><span>{LAYOUTS[view.layout].description}</span></div></div><div className={`phase-badge phase-${view.phase}`} data-testid="match-phase" data-phase={view.phase}><i />{phaseNames[view.phase]}</div><button className="icon-button expand-button" aria-label={full ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={fullscreen}>{full ? <X size={17} /> : <Expand size={17} />}</button></div>

            <div className="scoreboard"><TeamScore robot={view.robots[0]} /><div className="versus"><span>VS</span><time>{clock(view.time)}</time></div><TeamScore robot={view.robots[1]} /></div>

            <div className="arena-stage">
              <div ref={canvasHost} className={`duel-canvas ${manual ? 'is-interactive' : ''}`} data-testid="duel-canvas" />
              {manual && <Joystick onMove={moveJoystick} disabled={view.phase !== 'running' || trainingBusy || trainingOpen || brainOpen || help} resetKey={controlReset} />}
              <div className="stage-top"><span className="stage-tag"><Radio size={11} /> {manual ? 'GÖSTEREREK ÖĞRET' : 'ÖĞRENİLMİŞ MODEL'}</span><span className="stage-coordinate">{COURT.width} × {COURT.depth} M <i /> BÖLGE SINIRI AKTİF</span></div>
              <div className="stage-tools"><button className="stage-tool" aria-label="GRU modelini incele" onClick={() => setBrainOpen(true)}><BrainCircuit size={17} /></button><button className="stage-tool" data-testid="camera-toggle" title="Kamera açısını değiştir" aria-label={camera === 'perspective' ? 'Üstten görünüm' : 'Perspektif görünüm'} onClick={() => setCamera(camera === 'perspective' ? 'overhead' : 'perspective')}><Layers3 size={17} /></button><button className="stage-tool weather-tool" data-testid="weather-toggle" data-weather={weather} title={`Hava: ${weather === 'auto' ? 'Değişken' : weather === 'clear' ? 'Güneşli' : 'Yağmurlu'}`} aria-label={`Hava: ${weather === 'auto' ? 'Değişken' : weather === 'clear' ? 'Güneşli' : 'Yağmurlu'}. Değiştir`} onClick={() => setWeather(weather === 'auto' ? 'clear' : weather === 'clear' ? 'rain' : 'auto')}>{weather === 'rain' ? <CloudRain size={17} /> : weather === 'clear' ? <Sun size={17} /> : <CloudSun size={17} />}</button><button ref={trainingToggle} className={`stage-tool training-toggle ${trainingBusy ? 'is-training' : ''}`} data-testid="training-toggle" aria-expanded={trainingOpen} aria-controls="arena-training-panel" aria-label={trainingOpen ? 'Eğitim panelini kapat' : 'Eğitim panelini aç'} title="Robot eğitimi" onClick={toggleTraining}>{trainingBusy ? <LoaderCircle size={17} /> : <Sparkles size={17} />}<span>{trainingBusy && trainProgress ? `${trainProgress.epoch}/${trainProgress.epochs}` : 'Eğit'}</span></button></div>
              <div ref={trainingPopover} className={`arena-training-popover ${trainingRun || trainingLoss !== null ? 'has-training-details' : ''}`} hidden={!trainingOpen}><section id="arena-training-panel" className="arena-training-bar" role="dialog" aria-modal="false" aria-label="Robot eğitimi"><div className="arena-training-header"><div><Sparkles size={16} /><strong>Robot eğitimi</strong></div><button type="button" className="training-close" data-testid="training-close" aria-label="Eğitim panelini kapat" onClick={() => closeTraining()}><X size={17} /></button></div><div className="arena-training-main"><div className="arena-training-meta"><BrainCircuit size={15} /><span data-testid="arena-sample-count">{sampleCount} örnek</span></div><div className="training-controls">
          <div className="epoch-control">
            <label htmlFor="training-epochs">Tur sayısı</label>
            <div className="epoch-stepper">
              <button type="button" aria-label="Tur sayısını azalt" disabled={trainingBusy || trainingEpochs <= 1} onClick={() => setTrainingEpochs(value => Math.max(1, value - 1))}>−</button>
              <input id="training-epochs" aria-label="Eğitim tur sayısı" type="number" min="1" max="500" step="1" inputMode="numeric" value={trainingEpochs} disabled={trainingBusy} onChange={event => setTrainingEpochs(Math.max(1, Math.min(500, Math.floor(Number(event.target.value) || 1))))} />
              <button type="button" aria-label="Tur sayısını artır" disabled={trainingBusy || trainingEpochs >= 500} onClick={() => setTrainingEpochs(value => Math.min(500, value + 1))}>+</button>
            </div>
          </div>{trainingBusy ? <button className="train-button" data-testid="cancel-training" onClick={() => trainAbort.current?.abort()}><Pause size={14} /> Eğitimi durdur</button> : <button className="train-button" data-testid="train-robot" disabled={!learningReady || sampleCount < 16} onClick={() => void teachRobot()}><Sparkles size={15} /> Robotuna öğret</button>}</div></div>{trainingOpen && <div data-testid={trainingBusy ? 'training-progress' : undefined}><TrainingDetails run={trainingRun} savedLoss={trainingLoss} modelSteps={model.current!.trainedSteps} /></div>}{learningNotice && <p className="learning-notice">{learningNotice}</p>}</section></div><span className="training-panel-live" aria-live="polite">{learningNotice}</span>
              {renderError && <div className="render-error"><ScanLine /><strong>3D görünüm başlatılamadı</strong><p>Tarayıcının donanım hızlandırmasını etkinleştirip sayfayı yenile.</p></div>}
              {view.phase === 'ready' && !renderError && <div className="ready-caption"><span><span /> İKİ ROBOT HAZIR</span><p>Maçı başlat. Robotuna oynayarak göster.</p></div>}
              {view.phase === 'paused' && <div className="pause-overlay"><Pause size={24} /><strong>{trainingBusy ? 'Robotun öğreniyor.' : 'Bir nefes arası.'}</strong><span>{trainingBusy ? 'Eğitim tamamlanınca devam edebilirsin.' : 'Robotlar bir sonraki hamleni bekliyor.'}</span><button disabled={trainingBusy} onClick={() => { togglePause(state.current); publish(); }}><Play size={15} /> Devam et</button></div>}
              {view.phase === 'finished' && <div className={`winner-overlay team-${view.winner === 1 ? 1 : 0}`} role="status"><Trophy size={34} /><span>KARŞILAŞMA TAMAMLANDI</span><h3>{view.winner === 'draw' ? 'Berabere.' : `${teamNames[view.winner ?? 0]} kazandı.`}</h3><p>{clock(view.time)} süre · {view.robots.reduce((sum, item) => sum + item.shots, 0)} atış</p><button disabled={trainingBusy} onClick={() => reset()}><RotateCcw size={15} /> Rövanş hazırla</button></div>}
              <div className="court-side-label side-zero">ATLAS BÖLGESİ</div><div className="court-side-label side-one">KOR BÖLGESİ</div>
            </div>

            <div className="arena-legend"><span><i className="legend-bounce" /> Seken duvar</span><span><i className="legend-phase" /> Geçirgen duvar</span><span><Box size={12} /> Taşınabilir siper</span><span className="legend-center"><i /> Geçilemez orta çizgi</span></div>
            <div className="arena-controls"><div className="play-controls">{view.phase === 'ready' || view.phase === 'finished' ? <button className="primary-button" data-testid="start-match" disabled={renderError || !learningReady || trainingBusy} onClick={beginDuel}><Play size={16} fill="currentColor" />{view.phase === 'finished' ? 'Yeni düello' : 'Düelloyu başlat'}</button> : <button className="primary-button" data-testid="pause-match" disabled={trainingBusy} onClick={() => { togglePause(state.current); publish(); }}>{view.phase === 'running' ? <Pause size={16} /> : <Play size={16} />}{view.phase === 'running' ? 'Duraklat' : 'Devam et'}</button>}<button className="icon-button reset-button" data-testid="reset-match" disabled={trainingBusy} aria-label="Yeni maç hazırla" title="Yeni maç hazırla" onClick={() => reset()}><RotateCcw size={17} /></button><button className="arena-model-toggle" data-testid="watch-robot" aria-label={manual ? 'Robotumu izle' : 'Kontrolü devral'} aria-pressed={!manual} disabled={!learningReady || trainingBusy || (manual && !trained)} onClick={() => manual ? watchRobot() : useTeachingMode()}>{manual ? <Play size={14} /> : <Gamepad2 size={15} />}<span className="arena-model-label">{manual ? 'Robotumu izle' : 'Kontrolü devral'}</span><span className="arena-model-short" aria-hidden="true">{manual ? 'Robotu izle' : 'Devral'}</span></button></div><div className="simulation-controls"><label><span>HIZ</span><select aria-label="Simülasyon hızı" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><button className="icon-button" aria-label={sound ? 'Sesi kapat' : 'Sesi aç'} aria-pressed={sound} onClick={changeSound}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div></div>

            {manual && <ManualControls input={input} disabled={view.phase !== 'running' || trainingBusy || trainingOpen || brainOpen || help} cooldown={view.robots[0].cooldown} queued={pendingShot.current !== null} carrying={Boolean(view.robots[0].carrying)} />}
            {!manual && <RobotControlMonitor control={controlView} robot={view.robots[0]} phase={view.phase} time={view.time} />}
          </section>

          <details className="training-drawer"><summary><span><BrainCircuit size={17} /> Robotunu eğit</span><span>{sampleCount} örnek · {trained ? 'Model hazır' : 'Oyna ve göster'}<ChevronRight size={16} /></span></summary>
      <section className="learning-panel" aria-label="Robot eğitimi"><div className="learning-steps"><button data-testid="teach-mode" className={manual ? 'current' : ''} disabled={trainingBusy} onClick={useTeachingMode}><span>01</span><div><strong>Oyna ve göster</strong><small>Hareket · nişan · ateş · siper</small></div></button><div className={`learning-step ${trainingBusy ? 'current' : ''}`}><span>02</span><div><strong>Robotuna öğret</strong><small>Örneklerinden gerçek eğitim</small></div></div><div className={`learning-step ${!manual ? 'current' : ''}`}><span>03</span><div><strong>Robotumu izle</strong><small>Öğrendiğini rakibe karşı sına</small></div></div></div><div className="learning-actions"><div className="sample-status"><span className={manual && recording && view.phase === 'running' ? 'recording-dot' : ''} /><div><strong data-testid="sample-count">{sampleCount} örnek</strong><small data-testid="model-status">{trained ? 'Eğitilmiş model hazır' : 'Robotun henüz eğitilmedi'}</small></div></div><button className="record-toggle" aria-pressed={recording} onClick={() => { episode.current = { id: `${Date.now()}-${++episodeNumber.current}`, first: true }; setRecording(!recording); }}>{recording ? <Radio size={13} /> : <Pause size={13} />}{recording ? 'Kayıt açık' : 'Kayıt kapalı'}</button></div><div className="learning-footnote"><span>77.926 parametreli GRU · Örnekler ve model bu cihazda saklanır. Farklı durumlar göstererek geliştirebilirsin.{trainingLoss !== null ? ` Son eğitim hatası: ${trainingLoss.toFixed(4)}.` : ''}</span><button disabled={trainingBusy || sampleCount === 0} onClick={() => { samples.current = []; setSampleCount(0); saveLearning(); }}>Örnekleri temizle</button></div></section>
          <section className="tactics-panel" aria-label="Maç ayarları"><div className="section-heading"><span><Swords size={15} /> ANTRENMAN PLANI</span><span>Modelin korunur.</span></div><div className="tactics-grid"><div className="tactic-team team-0"><div className="tactic-team-title"><i />ATLAS<span>SENİN ROBOTUN</span></div><p className="learned-tactic">{manual ? 'Nasıl oynayacağını sen gösteriyorsun.' : 'Kararlarını senin örneklerinden öğreniyor.'}</p></div>{view.robots.filter(item => item.id === 1).map(item => <div key={item.id} className={`tactic-team team-${item.id}`}><div className="tactic-team-title"><i />{teamNames[item.id]}<span>ANTRENMAN RAKİBİ</span></div><div className="strategy-options" role="group" aria-label={`${teamNames[item.id]} stratejisi`}>{(Object.keys(STRATEGIES) as Strategy[]).map(strategy => <button key={strategy} title={STRATEGIES[strategy].description} className={item.strategy === strategy ? 'selected' : ''} aria-pressed={item.strategy === strategy} onClick={() => changeStrategy(item.id, strategy)}>{strategy === 'aggressive' ? <Zap size={13} /> : strategy === 'defensive' ? <Shield size={13} /> : <Activity size={13} />}{STRATEGIES[strategy].label}</button>)}</div></div>)}<div className="court-select"><label htmlFor="court-layout">ARENA DÜZENİ</label><select id="court-layout" aria-label="Arena seçimi" value={view.layout} onChange={event => reset(event.target.value as CourtLayout)}>{(Object.keys(LAYOUTS) as CourtLayout[]).map(layout => <option key={layout} value={layout}>{LAYOUTS[layout].label} · {LAYOUTS[layout].description}</option>)}</select></div></div></section>

          <div className="control-mode"><div><Gamepad2 size={20} /><div><strong>{manual ? 'Her hamlen bir örnek.' : 'Şimdi öğrendiklerini izliyorsun.'}</strong><p>{manual ? 'ATLAS’ı yönet; hareket, atış ve siper kararlarını göster.' : 'Hatasını görürsen kontrolü alıp yeni örnekler ekle.'}</p></div></div><button data-testid="manual-mode" aria-pressed={manual} disabled={trainingBusy || (manual && !trained)} onClick={() => manual ? watchRobot() : useTeachingMode()}>{manual ? <><Sparkles size={14} /> Robotumu izle</> : <>Kontrolü devral <ArrowDownRight size={15} /></>}</button></div>
          </details>
        </div>

        <aside className="duel-sidebar">
          <section className="gru-model-panel" data-testid="gru-model"><div className="section-heading"><span><BrainCircuit size={15} /> ATLAS · GERÇEK GRU</span><span>77.926</span></div><div className="gru-preview"><BrainCanvas trace={brainTrace} network={getDuelParameters(model.current!)} running={view.phase === 'running' && !manual} suspended={trainingBusy} compact outputNames={MOTOR_NAMES} outputMode="motors" /></div><div className="gru-model-footer"><span>160 → 96 → GRU96 → 64 → 6</span><button data-testid="brain-open" onClick={() => setBrainOpen(true)}>Modeli incele <Expand size={12} /></button></div></section>
          <section className="decision-panel"><div className="section-heading"><span><Activity size={14} /> ROBOTUN ZİHNİ</span><span className="live-dot">CANLI</span></div><div className="robot-tabs" role="group" aria-label="Kararları izlenen robot">{view.robots.map(item => <button key={item.id} className={`team-${item.id} ${selected === item.id ? 'selected' : ''}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><i />{teamNames[item.id]}<ChevronRight size={13} /></button>)}</div>
            <div className={`decision-content team-${selected}`}><div className="decision-visual"><div className="decision-orbit" /><RobotGlyph side={selected} /><span className="decision-chip"><span /> {selected === 1 ? 'ANTRENMAN RAKİBİ' : manual ? 'SEN ÖĞRETİYORSUN' : 'ÖĞRENİLMİŞ MODEL'}</span></div><div className="decision-label">ŞU ANKİ KARAR</div><h3>{view.phase === 'ready' ? 'Başlangıca hazır' : view.phase === 'finished' ? (robot.hp > 0 ? 'Görev tamamlandı' : 'Sistem devre dışı') : robot.decision.action}</h3><p>{view.phase === 'ready' ? selected === 0 ? 'Gösterdiğin hareketleri, nişanı, ateş zamanını ve siper kullanımını örneklerden öğrenecek.' : 'Kural tabanlı rakip, farklı oyun durumlarıyla robotunu eğitmene yardımcı olur.' : robot.decision.reason}</p>
              <div className="shot-readout"><div><span><Target size={13} /> ATIŞ YÖNÜ</span><strong>{angle.toFixed(0)}<small>°</small><MoveUpRight size={14} style={{ transform: `rotate(${angle + 45}deg)` }} /></strong></div><div><span><Zap size={13} /> TAŞ HIZI</span><strong>{shotSpeedForPower(robot.decision.power).toFixed(1)}<small>m/s</small></strong></div></div><div className="power-meter"><span>Sabit atış gücü <b>100%</b></span><div><i style={{ width: `${robot.decision.power * 100}%` }} /></div></div>
              <div className="robot-stats"><div><strong>{robot.shots}</strong><span>ATIŞ</span></div><div><strong>{robot.hits}</strong><span>İSABET</span></div><div><strong>{Math.round(robot.damage)}</strong><span>HASAR</span></div></div>
            </div>
          </section>

        </aside>
      </div>
    </main>

    {page !== 'workshop' && <OnlinePages page={page} model={model.current!} trained={trained} onTrain={() => selectPage('workshop')} />}
    <nav className="duel-bottom-nav" aria-label="Uygulama sekmeleri">{PAGES.map(({ id, label, icon: Icon }) => <button key={id} data-testid={`page-${id}`} aria-current={page === id ? 'page' : undefined} onClick={() => selectPage(id)}><Icon size={21} /><span>{label}</span></button>)}</nav>

    {brainOpen && <div className="help-backdrop" onClick={event => { if (event.target === event.currentTarget) setBrainOpen(false); }}><section className="duel-brain-dialog" role="dialog" aria-modal="true" aria-labelledby="gru-title" data-testid="brain-dialog"><button autoFocus className="icon-button help-close" aria-label="Model görünümünü kapat" onClick={() => setBrainOpen(false)}><X size={20} /></button><div className="eyebrow">ATLAS · ÖĞRENEN MODEL</div><h2 id="gru-title">96 hücrelik hafıza. <span>77.926 parametre.</span></h2><p>160 girdi → 96 algılama → GRU96 → 64 karar → 6 motor çıktısı. Nöronlar, kapılar ve bağlantılar gerçekten çalışan modelden gelir. Atış gücü sabit %100 olduğundan eski güç çıkışı yedekte tutulur.</p><div className="duel-expanded-brain"><BrainCanvas trace={brainTrace} network={getDuelParameters(model.current!)} running={view.phase === 'running' && !manual} suspended={trainingBusy} outputNames={MOTOR_NAMES} outputMode="motors" /></div><div className="motor-readouts">{MOTOR_NAMES.map((name, index) => <div key={name}><span>{name}</span><strong>{(brainTrace.layers[4]?.[index] ?? 0).toFixed(3)}</strong></div>)}</div><div className="model-file-actions"><span>{trained ? 'Eğitilmiş GRU' : 'Henüz eğitilmemiş GRU'} · {model.current!.trainedSteps.toLocaleString('tr-TR')} örnek güncellemesi</span><button onClick={() => void saveModelFile('NOEMA-Duel-GRU96.json', JSON.stringify(model.current)).catch(() => setLearningNotice('Model dosyası kaydedilemedi.'))}>Modeli indir</button><button disabled={trainingBusy} onClick={() => modelFile.current?.click()}>Model yükle</button><input ref={modelFile} type="file" accept=".json,application/json" hidden onChange={event => void loadModel(event.target.files?.[0])} /></div></section></div>}
    {help && <div className="help-backdrop" onClick={event => { if (event.target === event.currentTarget) setHelp(false); }}><section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><button autoFocus className="icon-button help-close" aria-label="Kuralları kapat" onClick={() => setHelp(false)}><X size={20} /></button><span className="eyebrow">ARENA REHBERİ</span><h2 id="help-title">Bir sonraki hamle sende.</h2><p>İki robot, birer yarı saha ve 240 can. Önce ATLAS ile oyna ve örnekler göster. Robotuna öğret ile eğit, Robotumu izle ile öğrendiğini dene. Kontrolü geri alıp hatalı durumdan yeni örnekler gösterebilirsin.</p><div className="help-rules"><div><ScanLine /><h3>Kendi sahanda kal</h3><p>Robotlar orta çizgiyi ve duvarları geçemez. Atışlar orta çizgiden serbestçe geçer.</p></div><div><Zap /><h3>Açıyı hesapla</h3><p>Turuncu duvarlar taşları sektirir. Saydam, kesikli duvarlar robotları durdurur; taşları geçirir.</p></div><div><Box /><h3>Siperini yanında taşı</h3><p>Kutular atışları emer ve hasar aldıkça kırılır. Robotlar kendi kutularını alıp yeni bir konuma bırakabilir. Kutu taşırken hareket yavaşlar ve ateş edilemez. Her robot 1,25 saniyede bir yeniden ateş edebilir. Her taş sekmeler dahil en fazla 45 metre yol alır.</p></div><div><Swords /><h3>Stratejini seç</h3><p>ATLAS senin gösterdiğin örneklerden öğrenir. KOR, hücum / dengeli / savunma davranışları seçilebilen kural tabanlı antrenman rakibidir.</p></div></div><div className="help-manual"><Gamepad2 size={20} /><p>Arenanın sol yarısında istediğin noktaya basıp sürükleyerek hareket et. Kontrol alanı görünmez; parmağını bırakınca durursun. Sağ yarıda dokunduğun noktaya doğru tek atış yapılır; ayrı ateş düğmesi yoktur. Tüm atışlar düz ve %100 güçtedir. Al / bırak ile siperini taşı. Tam ekranda telefonu yataya çevirebilirsin. Bilgisayarda WASD / yön tuşları ve fare kullanılır.</p></div><button className="primary-button" onClick={() => setHelp(false)}><Check size={16} /> Arenada görüşürüz</button></section></div>}
  </div>;
}
