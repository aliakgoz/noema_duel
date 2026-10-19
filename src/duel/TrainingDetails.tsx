import { useEffect, useState } from 'react';
import './training-details.css';

export type TrainingRun = {
  status: 'running' | 'complete' | 'cancelled' | 'error';
  epochs: number;
  sampleCount: number;
  startedAt: number;
  finishedAt?: number;
  history: Array<{ epoch: number; loss: number }>;
};

type Props = { run: TrainingRun | null; savedLoss: number | null; modelSteps: number };

const numberFormat = new Intl.NumberFormat('tr-TR');
const lossFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const formatLoss = (loss: number | null) => loss === null || !Number.isFinite(loss) ? '—'
  : loss !== 0 && Math.abs(loss) < .0001 ? loss.toExponential(2).replace('.', ',') : lossFormat.format(loss);

function LossChart({ history }: { history: TrainingRun['history'] }) {
  if (!history.length) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const losses = history.map(point => point.loss);
  const low = Math.min(...losses);
  const high = Math.max(...losses);
  const range = high - low;
  const epochRange = last.epoch - first.epoch;
  const points = history.map(point => ({
    x: epochRange > 0 ? 16 + (point.epoch - first.epoch) / epochRange * 208 : 120,
    y: range > 0 ? 66 - (point.loss - low) / range * 48 : 42,
  }));
  const line = points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const label = history.length === 1
    ? `${first.epoch}. tur: loss ${formatLoss(first.loss)}. Tek ölçüm.`
    : `${history.length} tur ölçümü. İlk loss ${formatLoss(first.loss)}, son loss ${formatLoss(last.loss)}. Üst sınır ${formatLoss(high)}, alt sınır ${formatLoss(low)}.`;
  return <figure className="training-details-chart">
    <svg viewBox="0 0 240 88" role="img" aria-label={label} data-testid="training-loss-chart" data-points={JSON.stringify(history)}>
      <title>Eğitim turlarına göre loss</title>
      <path className="training-details-grid" d="M16 18H224M16 42H224M16 66H224" />
      {history.length > 1 && <polyline className="training-details-curve" points={line} />}
      {points.map((point, index) => <circle key={`${history[index].epoch}-${index}`} className="training-details-point" cx={point.x} cy={point.y} r={history.length === 1 || index === points.length - 1 ? 3 : 1.5} />)}
      <text className="training-details-axis" x="16" y="83">{first.epoch}. tur</text>
      {history.length > 1 && <text className="training-details-axis" x="224" y="83" textAnchor="end">{last.epoch}. tur</text>}
    </svg>
    <figcaption>{history.length === 1 ? '1 tur ölçüldü' : `${numberFormat.format(history.length)} tur ölçüldü`}<span>Loss / tur</span></figcaption>
  </figure>;
}

export function TrainingDetails({ run, savedLoss, modelSteps }: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (run?.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.startedAt, run?.status]);

  const history = run?.history.filter(point => point.epoch > 0 && Number.isFinite(point.loss)) ?? [];
  const last = history[history.length - 1];
  const loss = run ? last?.loss ?? null : savedLoss;
  const completed = last?.epoch ?? 0;
  const elapsed = run ? Math.max(0, Math.floor(((run.finishedAt ?? now) - run.startedAt) / 1000)) : null;
  const interrupted = run?.status === 'cancelled' || run?.status === 'error';
  const statusLabel = run?.status === 'running' ? 'Eğitim sürüyor'
    : run?.status === 'complete' ? 'Eğitim tamamlandı'
      : run?.status === 'cancelled' ? 'Eğitim durduruldu'
        : run?.status === 'error' ? 'Eğitim tamamlanamadı'
          : savedLoss !== null ? 'Kaydedilen model' : 'Eğitime hazır';
  const lossLabel = !run ? 'Kaydedilen model loss’u' : interrupted ? 'Bu denemenin loss’u' : 'Son tur loss’u';

  return <section className="training-details" data-testid="training-details" data-status={run?.status ?? 'idle'} aria-label="Eğitim ayrıntıları">
    <div className="training-details-heading">
      <span className="training-details-status" data-testid="training-status" role="status" aria-live="polite" aria-atomic="true"><i aria-hidden="true" />{statusLabel}</span>
      {elapsed !== null && <span className="training-details-elapsed" data-testid="training-elapsed" data-seconds={elapsed}>{numberFormat.format(elapsed)} sn</span>}
    </div>
    <div className="training-details-loss"><span>{lossLabel}</span><strong data-testid="training-loss" data-loss={loss ?? undefined}>{formatLoss(loss)}</strong></div>
    {run?.status === 'running' && !history.length && <p className="training-details-waiting">İlk turun sonucu bekleniyor.</p>}
    {run && <>
      <dl className="training-details-stats">
        <div><dt>Tamamlanan tur</dt><dd data-testid="training-epochs-progress" data-completed={completed} data-total={run.epochs}>{numberFormat.format(completed)} <span>/ {numberFormat.format(run.epochs)}</span></dd></div>
        <div><dt>Eğitim örneği</dt><dd data-testid="training-sample-count">{numberFormat.format(run.sampleCount)}</dd></div>
      </dl>
      {run.status === 'running' && <progress className="training-details-progress" aria-label="Tamamlanan eğitim turları" value={completed} max={run.epochs} />}
    </>}
    <LossChart history={history} />
    {interrupted && <div className="training-details-retained"><strong>Önceki model korundu.</strong><span>Önceki model loss’u: <b data-testid="training-saved-loss" data-loss={savedLoss ?? undefined}>{savedLoss === null ? 'Henüz eğitilmedi' : formatLoss(savedLoss)}</b></span></div>}
    <p className="training-details-explanation">Loss, gösterdiğin hamlelere uyum hatasıdır.</p>
    <p className="training-details-model">Model eğitim adımı <span data-testid="training-model-steps">{numberFormat.format(modelSteps)}</span></p>
  </section>;
}
