import { FlaskConical, Pause, RefreshCw } from 'lucide-react';
import type { TransferReport, TrialMode } from '../evaluation/transfer';

const MODES: { id: TrialMode; label: string }[] = [
  { id: 'same', label: 'Aynı bölüm' },
  { id: 'start', label: 'Yakın başlangıç' },
  { id: 'layout', label: 'Benzer harita' },
];

export function TransferPanel({ report, busy, disabled, onEvaluate, onCancel }: {
  report?: TransferReport; busy: boolean; disabled: boolean;
  onEvaluate: () => void; onCancel: () => void;
}) {
  return <section className="transfer-panel" aria-label="Öğrenme ve genelleme deneyi">
    <div className="transfer-heading"><div><span className="eyebrow"><FlaskConical size={13}/> EZBERDEN KEŞFE</span><h3>Öğrendiğini başka koşullara taşıyabiliyor mu?</h3></div><button className="button button-outline" disabled={disabled && !busy} onClick={busy ? onCancel : onEvaluate}>{busy ? <Pause size={14}/> : <RefreshCw size={14}/>} {busy ? 'Denemeyi durdur' : '7 koşulda sına'}</button></div>
    <p className="trial-explanation">Aynı bölüm, üç yakın başlangıç ve üç benzer harita, modelin sabit bir kopyasıyla ayrı ayrı sınanır. Bu karşılaştırma, oynadığın bölümü değiştirmez.</p>
    {busy && <p className="transfer-working" role="status">Modelin sabit bir kopyası 7 koşulda karar veriyor…</p>}
    {report && <div className="transfer-report" aria-live="polite"><div className="transfer-scores">{MODES.map(option => {
      const cases = report.cases.filter(trial => trial.kind === option.id);
      return <div key={option.id}><strong>{cases.filter(trial => trial.solved).length}<small>/{cases.length}</small></strong><span>{option.label}</span><div className="trial-dots">{cases.map((trial, index) => <i key={index} className={trial.solved ? 'passed' : ''} title={`${trial.solved ? 'Çözüldü' : 'Çözülemedi'} · ${trial.decisions} karar · başlangıç (${trial.start.x}, ${trial.start.z})`}/>)}</div></div>;
    })}</div><details className="trial-details"><summary>Tek tek sonuçları incele</summary><ol>{report.cases.map((trial, index) => <li key={index}><strong>{MODES.find(option => option.id === trial.kind)?.label} · {trial.solved ? 'Çözüldü' : 'Çözülemedi'}</strong><span>{trial.decisions} karar · Başlangıç ({trial.start.x}, {trial.start.z}){trial.changes.length ? ` · ${trial.changes.join(' ')}` : ''}</span></li>)}</ol></details>{report.cases.length < report.requestedCases && <p>Bu oda için {report.cases.length} farklı ve çözülebilir koşul bulunabildi; tekrar eden koşullar sayılmadı.</p>}<p>Her koşul en fazla {report.budget} karar. Bu ölçümde model öğrenmez; sonuçları yalnızca kendi seçtiği tuşlar belirler. Örneklerine uyum ile yeni koşullardaki başarı farklı ölçümlerdir.</p></div>}
  </section>;
}
