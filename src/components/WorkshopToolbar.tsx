import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Shuffle, Undo2 } from 'lucide-react';
import type { Level } from '../core/types';
import './workshopToolbar.css';

export interface WorkshopToolbarProps {
  level: Level;
  levels: readonly Level[];
  chapters: readonly string[];
  disabled: boolean;
  running: boolean;
  onLevel: (level: Level) => void;
  onSimilar: () => void;
  onOriginal?: () => void;
  onRestartRobot: () => void;
}

export function WorkshopToolbar({ level, levels, chapters, disabled, running, onLevel, onSimilar, onOriginal, onRestartRobot }: WorkshopToolbarProps) {
  const canonicalId = level.sourceLevelId ?? level.id;
  const index = levels.findIndex(item => item.id === canonicalId);
  const previous = index > 0 ? levels[index - 1] : undefined;
  const next = levels[index + 1];
  const variant = Boolean(level.variantKind || level.sourceLevelId);
  const groups = [...new Set(levels.map(item => item.chapter))];
  return <div className="workshop-toolbar" aria-label="Bölüm ve deneme seçenekleri" data-variant={variant && Boolean(onOriginal)} data-running={running}>
    <div className="workshop-toolbar-main">
      <div className="workshop-level-navigation">
        <button className="workshop-step" aria-label="Önceki bölüm" title="Önceki bölüme geç" disabled={disabled || !previous} onClick={() => { if (previous) onLevel(previous); }}><ChevronLeft size={19}/></button>
        <label className="workshop-level-picker"><span>BÖLÜM SEÇ</span><select aria-label="Bölüm seç" value={canonicalId} disabled={disabled || !levels.length} onChange={event => { const selected = levels.find(item => item.id === event.target.value); if (selected) onLevel(selected); }}>
          {index < 0 && <option value={canonicalId}>Özel düzen · {level.title}</option>}
          {groups.map(chapter => <optgroup key={chapter} label={`${chapter}. ${chapters[chapter - 1] ?? 'Keşifler'}`}>
            {levels.map((item, itemIndex) => item.chapter === chapter && <option key={item.id} value={item.id}>{String(itemIndex + 1).padStart(2, '0')} · {item.title}</option>)}
          </optgroup>)}
        </select><ChevronDown size={15}/></label>
        <button className="workshop-step" aria-label="Sonraki bölüm" title="Sonraki bölüme geç" disabled={disabled || !next} onClick={() => { if (next) onLevel(next); }}><ChevronRight size={19}/></button>
      </div>
      <div className="workshop-quick-actions">
        <button className="workshop-similar" disabled={disabled} onClick={onSimilar} title="Aynı bölümün küçük farklar içeren yeni bir düzenini aç"><Shuffle size={15}/><span>Benzer bölüm</span></button>
        <button aria-label="Robotu baştan izlet" disabled={disabled} onClick={onRestartRobot} title={running ? 'Robotu durdurup bu düzeni baştan izler' : 'Robot bu düzenin başlangıcından oynar'}><RotateCcw size={15}/><span>Baştan izle</span></button>
        {variant && onOriginal && <button className="workshop-original" disabled={disabled} onClick={onOriginal} title="Bu bölümün asıl düzenine dön"><Undo2 size={15}/><span>Asıl düzen</span></button>}
      </div>
    </div>
    <p className="workshop-watch-hint"><span/>Robotu izle, bulunduğun yerden devam eder.</p>
  </div>;
}
