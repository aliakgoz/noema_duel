import { useEffect, useRef, useState } from 'react';
import type { ActivationTrace } from '../ml/network';
import { MODEL_INPUTS } from '../core/types';
import {
  BRAIN_LAYER_NAMES, freezeBrainParameters, freezeBrainTrace, incomingConnections, neuronBias, neuronValue,
  type BrainConnection, type BrainParameters, type BrainSelection, type GateView,
} from './brainSignals';
import './brain.css';

export interface BrainCanvasProps { trace?: ActivationTrace; network: BrainParameters & { parameterCount: number; trainedSteps: number }; running: boolean; compact?: boolean; suspended?: boolean; outputNames?: readonly string[]; outputMode?: 'actions' | 'motors' }
type Neuron = BrainSelection & { x: number; y: number; radius: number };
const COLORS = { cyan: '#75e7dc', copper: '#e8a77a', muted: '#718a9c' };
const COUNTS = [MODEL_INPUTS, 96, 96, 64, 6];
const OUTPUT_NAMES = ['Yukarı', 'Sağ', 'Aşağı', 'Sol', 'Etkileşim', 'Bekle'];
const GATE_LABELS: Record<GateView, string> = { memory: 'Bellek h', reset: 'Sıfırlama r', update: 'Koruma z', candidate: 'Aday n' };
const numeric = (value: number | undefined) => value === undefined ? '—' : value.toFixed(4);
const average = (values: number[] | undefined) => values?.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;

function positions(width: number, height: number): Neuron[][] {
  const result: Neuron[][] = [[], [], [], [], []];
  for (let i = 0; i < MODEL_INPUTS; i++) result[0].push({ layer: 0, index: i,
    x: width * (0.045 + (i % 4) * 0.009), y: height * (0.15 + Math.floor(i / 4) / 39 * 0.68),
    radius: Math.max(0.55, Math.min(1.55, width * 0.0025)) });
  for (const [layer, center, rows, extent] of [[1, 0.265, 12, 0.095], [2, 0.51, 12, 0.107], [3, 0.755, 8, 0.078]]) {
    for (let i = 0; i < COUNTS[layer]; i++) {
      const row = Math.floor(i / 8); const column = i % 8;
      const vertical = (row - (rows - 1) / 2) / ((rows - 1) / 2);
      const taper = 0.57 + 0.43 * Math.sqrt(Math.max(0, 1 - vertical * vertical));
      result[layer].push({ layer, index: i,
        x: width * (center + (column - 3.5) / 3.5 * extent * taper),
        y: height * (0.49 + vertical * (layer === 3 ? 0.265 : 0.31) + Math.sin(column * 1.25 + row * 0.75) * 0.005),
        radius: Math.max(0.8, Math.min(layer === 2 ? 3.2 : 2.8, width * 0.0048)) });
    }
  }
  for (let i = 0; i < 6; i++) result[4].push({ layer: 4, index: i, x: width * 0.94,
    y: height * (0.22 + i * 0.11), radius: Math.max(1.7, Math.min(5.2, width * 0.0075)) });
  return result;
}
function strongest(connections: BrainConnection[], mode: 'activity' | 'weights', count: number): BrainConnection[] {
  return connections.sort((a, b) => Math.abs(mode === 'weights' ? b.weight : b.contribution)
    - Math.abs(mode === 'weights' ? a.weight : a.contribution)).slice(0, count);
}

export default function BrainCanvas({ trace, network, running, compact = false, suspended = false, outputNames = OUTPUT_NAMES, outputMode = 'actions' }: BrainCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const containerRef = useRef<HTMLDivElement>(null);
  const neurons = useRef<Neuron[][]>([]);
  const [mode, setMode] = useState<'activity' | 'weights'>('activity');
  const [gateView, setGateView] = useState<GateView>('memory');
  const [paused, setPaused] = useState(false);
  const [selection, setSelection] = useState<BrainSelection | null>(null);
  const frozen = useRef<{ trace?: ActivationTrace; parameters: BrainParameters } | undefined>(undefined);
  const currentTrace = paused ? frozen.current?.trace : trace;
  const parameters: BrainParameters = paused && frozen.current ? frozen.current.parameters : network;
  const selectedValue = selection ? neuronValue(currentTrace, selection.layer, selection.index, gateView) : undefined;
  const selectedBias = selection ? neuronBias(parameters, currentTrace, selection, gateView) : undefined;
  const selectedConnections = selection ? strongest(incomingConnections(parameters, currentTrace, selection, gateView), mode, 4) : [];
  const memory = currentTrace?.recurrent;
  const retention = average(memory?.update); const reset = average(memory?.reset);

  useEffect(() => {
    const canvas = canvasRef.current; const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let width = 0; let height = 0;
    function draw() {
      if (!ctx || !width || !height) return;
      const layers = neurons.current;
      ctx.clearRect(0, 0, width, height);
      const mist = ctx.createRadialGradient(width * 0.5, height * 0.47, 0, width * 0.5, height * 0.47, width * 0.48);
      mist.addColorStop(0, 'rgba(78,158,158,0.11)'); mist.addColorStop(0.65, 'rgba(43,87,111,0.035)'); mist.addColorStop(1, 'transparent');
      ctx.fillStyle = mist; ctx.fillRect(0, 0, width, height);
      // Only the outline is decorative. Nodes, edges and gates use real model data.
      ctx.save(); ctx.strokeStyle = 'rgba(141,199,201,.13)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(width * .15, height * .46);
      ctx.bezierCurveTo(width * .12, height * .12, width * .33, height * .10, width * .38, height * .20);
      ctx.bezierCurveTo(width * .47, height * .04, width * .65, height * .10, width * .65, height * .24);
      ctx.bezierCurveTo(width * .87, height * .16, width * .91, height * .65, width * .81, height * .77);
      ctx.bezierCurveTo(width * .72, height * .89, width * .63, height * .79, width * .60, height * .84);
      ctx.bezierCurveTo(width * .47, height * .94, width * .42, height * .78, width * .38, height * .82);
      ctx.bezierCurveTo(width * .25, height * .94, width * .11, height * .77, width * .15, height * .46); ctx.stroke();
      for (const center of [.265, .51, .755]) for (let fold = 0; fold < 3; fold++) {
        const y = height * (.31 + fold * .18); ctx.strokeStyle = 'rgba(141,199,201,.055)';
        ctx.beginPath(); ctx.moveTo(width * (center - .065), y);
        ctx.bezierCurveTo(width * (center - .025), y - height * .05, width * (center + .02), y + height * .04,
          width * (center + .065), y - height * .025); ctx.stroke();
      }
      ctx.restore();
      const paintConnection = (edge: BrainConnection) => {
        const source = layers[edge.sourceLayer]?.[edge.sourceIndex]; const target = layers[edge.targetLayer]?.[edge.targetIndex];
        if (!source || !target) return;
        const value = mode === 'weights' ? edge.weight : edge.contribution;
        const strength = Math.min(1, Math.abs(value) * (mode === 'weights' ? 2 : 4));
        const isMemory = edge.kind === 'memory';
        const alpha = (selection ? .07 : .018) + strength * (selection ? .67 : .42);
        ctx.strokeStyle = value >= 0 ? `rgba(117,231,220,${alpha})` : `rgba(232,167,122,${alpha})`;
        ctx.lineWidth = .45 + strength * (selection ? 1.8 : .95); ctx.setLineDash(isMemory ? [2, 2] : []); ctx.beginPath();
        if (isMemory) {
          // Outlined source represents previous-step memory, not this step's h.
          const offset = Math.max(3, width * .005); ctx.moveTo(source.x - offset, source.y - offset);
          ctx.bezierCurveTo(source.x + width * .11, source.y - height * .15,
            target.x + width * .11, target.y - height * .15, target.x, target.y);
        } else {
          const bend = (target.x - source.x) * .48; ctx.moveTo(source.x, source.y);
          ctx.bezierCurveTo(source.x + bend, source.y, target.x - bend, target.y, target.x, target.y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      };
      for (let layer = 1; layer < layers.length; layer++) for (const node of layers[layer]) {
        const all = incomingConnections(parameters, currentTrace, node, gateView);
        if (selection) {
          for (const edge of all) if ((selection.layer === edge.targetLayer && selection.index === edge.targetIndex)
            || (selection.layer === edge.sourceLayer && selection.index === edge.sourceIndex)) paintConnection(edge);
        } else if (layer === 2) {
          for (const edge of strongest(all.filter(edge => edge.kind === 'input'), mode, 2)) paintConnection(edge);
          for (const edge of strongest(all.filter(edge => edge.kind === 'memory'), mode, 1)) paintConnection(edge);
        } else for (const edge of strongest(all, mode, layer === 4 ? 7 : 2)) paintConnection(edge);
      }
      for (const layer of layers) for (const node of layer) {
        const value = neuronValue(currentTrace, node.layer, node.index, gateView); const amount = Math.min(1, Math.abs(value));
        const selected = selection?.layer === node.layer && selection.index === node.index;
        if (node.layer === 2 && memory) {
          const offset = Math.max(3, width * .005); const previous = memory.previous[node.index] ?? 0;
          ctx.strokeStyle = previous >= 0 ? `rgba(117,231,220,${.1 + Math.abs(previous) * .4})` : `rgba(232,167,122,${.1 + Math.abs(previous) * .4})`;
          ctx.lineWidth = .65; ctx.beginPath(); ctx.arc(node.x - offset, node.y - offset, node.radius * .65, 0, Math.PI * 2); ctx.stroke();
        }
        if (amount > .1 || selected) {
          const halo = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * (selected ? 5 : 3.3));
          halo.addColorStop(0, value >= 0 ? `rgba(117,231,220,${.08 + amount * .19})` : `rgba(232,167,122,${.08 + amount * .19})`);
          halo.addColorStop(1, 'transparent'); ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(node.x, node.y, node.radius * (selected ? 5 : 3.3), 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = currentTrace ? value >= 0 ? COLORS.cyan : COLORS.copper : '#496074';
        ctx.globalAlpha = currentTrace ? .22 + amount * .78 : .45;
        ctx.beginPath(); ctx.arc(node.x, node.y, node.radius + (selected ? .8 : 0), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        if (node.layer === 2 && memory && !compact) {
          // Violet circumference is the actual retained fraction z.
          ctx.strokeStyle = `rgba(177,162,232,${.2 + memory.update[node.index] * .55})`; ctx.lineWidth = .8;
          ctx.beginPath(); ctx.arc(node.x, node.y, node.radius + 1.8, -Math.PI / 2, -Math.PI / 2 + memory.update[node.index] * Math.PI * 2); ctx.stroke();
        }
        if (selected || (outputMode === 'actions' && node.layer === 4 && currentTrace?.action === node.index)) {
          ctx.strokeStyle = selected ? '#edf7f1' : COLORS.cyan; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(node.x, node.y, node.radius + 3.5, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.textAlign = 'center'; ctx.fillStyle = COLORS.muted;
      ctx.font = `${compact ? Math.max(5, Math.min(7, width / 36)) : Math.max(7, Math.min(9, width / 75))}px ui-monospace,monospace`;
      const labels = compact ? [`${MODEL_INPUTS}`, '96', 'GRU 96', '64', '6'] : [`GİRDİ · ${MODEL_INPUTS}`, 'ALGILAMA · 96', 'GRU · 96', 'KARAR · 64', outputMode === 'motors' ? '6 MOTOR' : '6 EYLEM'];
      for (let layer = 0; layer < labels.length; layer++) ctx.fillText(labels[layer], width * [.06, .265, .51, .755, .94][layer], height * .055);
      ctx.fillStyle = 'rgba(177,162,232,.72)';
      ctx.fillText(compact ? 'h(t−1) ↺ h(t)' : 'ÖNCEKİ BELLEK h(t−1) ↺ h(t)', width * .51, height * .965);
      if (!compact) {
        ctx.fillStyle = COLORS.muted; ctx.fillText('TANH', width * .265, height * .945); ctx.fillText('TANH', width * .755, height * .945);
        ctx.fillText(outputMode === 'motors' ? 'MOTOR' : 'SOFTMAX', width * .94, height * .945);
      }
    }
    const resize = () => {
      width = container.clientWidth; height = container.clientHeight; const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      neurons.current = positions(width, height); draw();
    };
    // No invented signal animation between decisions: actual predictions trigger redraws.
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    return () => observer.disconnect();
  }, [mode, gateView, paused, selection, compact, currentTrace, parameters, network.trainedSteps, outputMode]);

  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
    let nearest: Neuron | undefined; let distance = compact ? 9 : 14;
    for (const layer of neurons.current) for (const node of layer) {
      const current = Math.hypot(node.x - x, node.y - y);
      if (current < distance) { nearest = node; distance = current; }
    }
    setSelection(nearest ? { layer: nearest.layer, index: nearest.index } : null);
  };
  const keyboardSelect = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); setSelection(null); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const current = selection ?? { layer: 2, index: 0 };
    let layer = current.layer; let index = current.index;
    if (event.key === 'ArrowLeft') layer = Math.max(0, layer - 1); if (event.key === 'ArrowRight') layer = Math.min(4, layer + 1);
    if (event.key === 'ArrowUp') index--; if (event.key === 'ArrowDown') index++;
    if (event.key === 'Home') index = 0; if (event.key === 'End') index = COUNTS[layer] - 1;
    setSelection({ layer, index: Math.max(0, Math.min(COUNTS[layer] - 1, index)) });
  };

  return <div className={`brain-canvas brain-gru${compact ? ' brain-canvas--compact' : ''}`} data-model="gru96" data-frozen={paused}
    data-gate-view={gateView} data-selected-layer={selection?.layer} data-selected-neuron={selection?.index} data-parameter-count={network.parameterCount}
    data-gru-memory={JSON.stringify(memory?.memory ?? [])} data-gru-previous={JSON.stringify(memory?.previous ?? [])}>
    <div className="brain-toolbar"><div className="brain-view-toggle">
      {(['activity', 'weights'] as const).map(value => <button type="button" key={value} onClick={() => setMode(value)}
        aria-pressed={mode === value} aria-label={value === 'activity' ? 'Gerçek aktivasyon katkılarını göster' : 'Gerçek model ağırlıklarını göster'}>
        {value === 'activity' ? compact ? 'Sinyal' : 'Aktivasyon' : compact ? 'Ağırlık' : 'Ağırlıklar'}</button>)}</div>
      <button type="button" className="brain-freeze" aria-pressed={paused}
        aria-label={paused ? 'Canlı model görünümüne devam et' : 'Model sinyallerini incelemek için görünümü dondur'} onClick={() => {
          if (!paused) frozen.current = { trace: freezeBrainTrace(trace), parameters: freezeBrainParameters(network) }; setPaused(!paused);
        }}>{compact ? paused ? '▶' : 'Ⅱ' : paused ? '▶ Devam' : 'Ⅱ İncele'}</button></div>
    <div className="brain-gate-control"><span className="brain-gru-chip">GRU</span>
      <select aria-label="GRU nöronlarında gösterilen değer" value={gateView} onChange={event => setGateView(event.target.value as GateView)}>
        {(Object.keys(GATE_LABELS) as GateView[]).map(gate => <option key={gate} value={gate}>{GATE_LABELS[gate]}</option>)}</select>
      <span className="brain-retention" title="96 hücrenin gerçek koruma kapısı ortalaması">z̄ {retention === undefined ? '—' : `${Math.round(retention * 100)}%`}</span></div>
    <div ref={containerRef} className="brain-drawing">
      <canvas ref={canvasRef} onPointerDown={pick} onKeyDown={keyboardSelect} tabIndex={0} role="img"
        aria-label={`${MODEL_INPUTS} girdi, 96 algılama nöronu, 96 GRU bellek hücresi, 64 karar nöronu, 6 çıktı. Noktalı bağlar önceki belleği taşır. Nöron seçmek için dokunun veya yön tuşlarını kullanın.`}/>
      {!currentTrace && !compact && <span className="brain-awaiting">İlk gözlem bekleniyor</span>}</div>
    {!compact && <div className="brain-memory-summary" aria-label="GRU kapı özeti">
      <div><span>Önceki belleği koruma · z̄</span><strong>{retention === undefined ? '—' : `${(retention * 100).toFixed(1)}%`}</strong><i><b style={{ width: `${(retention ?? 0) * 100}%` }}/></i></div>
      <div><span>Geçmişi adaya açma · r̄</span><strong>{reset === undefined ? '—' : `${(reset * 100).toFixed(1)}%`}</strong><i><b style={{ width: `${(reset ?? 0) * 100}%` }}/></i></div></div>}
    <div className="brain-inspection" aria-live="polite"><div className="brain-inspection-heading"><span>{selection
      ? `${BRAIN_LAYER_NAMES[selection.layer]} / n${String(selection.index).padStart(3, '0')} · ${selection.layer === 2 ? GATE_LABELS[gateView] : selection.layer === 4 ? outputNames[selection.index] : 'a'} = ${numeric(selectedValue)}`
      : compact ? 'h(t) = z·h(t−1) + (1−z)·n' : 'h(t) = z · h(t−1) + (1−z) · n'}</span><span className="brain-signs"><i>● +</i> <b>● −</b></span></div>
      {!compact && selection && <div className="brain-neuron-detail">
        {selection.layer === 2 && memory && <div className="brain-cell-values">
          {(['previous', 'reset', 'update', 'candidate', 'memory'] as const).map((key, index) => <span key={key}>
            <small>{['h(t−1)', 'r', 'z', 'n', 'h(t)'][index]}</small><strong>{numeric(memory[key][selection.index])}</strong></span>)}</div>}
        {selectedBias && <p className="brain-bias">{selectedBias.hidden === undefined ? `Bias b = ${numeric(selectedBias.input)}`
          : `Bias bₓ = ${numeric(selectedBias.input)} · bₕ = ${numeric(selectedBias.hidden)} · birleşik = ${numeric(selectedBias.effective)}`}</p>}
        {selectedConnections.length > 0 && <div className="brain-weight-list" aria-label="Seçilen nöronun en güçlü dört giriş bağlantısı">
          <span className="brain-weight-header"><span>Kaynak</span><span>Ağırlık w</span><span>Katkı</span></span>
          {selectedConnections.map(edge => <span key={`${edge.kind}-${edge.sourceIndex}`}><span>{edge.kind === 'memory' ? 'h(t−1)' : BRAIN_LAYER_NAMES[edge.sourceLayer]} n{edge.sourceIndex}</span>
            <span>{numeric(edge.weight)}</span><span>{numeric(edge.contribution)}</span></span>)}</div>}
        {selection.layer === 0 && <p className="brain-bias">Girdi nöronu; öğrenilen giriş ağırlığı veya bias içermez.</p>}</div>}
      {!compact && !selection && <p className="brain-explanation">Bir nörona dokunarak ağırlıklarını incele. Mor yay korunan bellek oranı z; noktalı bağlar h(t−1). {mode === 'activity' ? 'Bağlar gerçek a × w katkısını gösterir; GRU adayının geçmiş katkısında r de uygulanır.' : 'Bağlar öğrenilen ağırlıkları gösterir.'}</p>}</div>
    <span className="brain-live-state" aria-hidden="true">{paused ? 'DONDURULDU' : suspended ? 'EĞİTİLİYOR' : running ? 'CANLI' : ''}</span>
  </div>;
}
export { BrainCanvas };
