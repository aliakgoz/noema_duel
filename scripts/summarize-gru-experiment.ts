/** Consolidate completed, verified experiment artifacts; never train or select models. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

interface Case { split: string; taskFamily: string; solved: boolean }
interface EvaluatedModel {
  id: string; architecture: string; seed: number; parameterCount: number; cases: Case[];
  numericParity: { maxAbsoluteError: number; tolerance: number };
  training: { epochs: number; optimizerUpdates: number; maskedTimestepsSeen: number; durationSeconds: number;
    teacherForced: Record<string, { accuracy: number }> };
}
const root = 'artifacts/gru-experiment';
const readJSON = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const [primary, control, primaryTraining, controlTraining, longParity] = await Promise.all([
  readJSON(root + '/closed-loop-results.json'), readJSON(root + '/capacity-control/closed-loop-results.json'),
  readJSON(root + '/training-summary.json'), readJSON(root + '/capacity-control/training-summary.json'),
  readJSON(root + '/long-parity/numerical-parity.json'),
]);
assert.equal(primary.status, 'passed'); assert.equal(control.status, 'passed');
assert(primaryTraining.finishedAt && controlTraining.finishedAt, 'Training artifacts are incomplete');
assert.equal(primary.models.length, 8); assert.equal(control.models.length, 2);
assert.equal(primary.datasetSHA256, control.datasetSHA256);
assert.equal(primary.decisionBudget, 220); assert.equal(control.decisionBudget, 220);
assert.equal(longParity.status, 'passed');
assert.equal(longParity.models.length, 8);
assert.equal(longParity.datasetSHA256, primary.datasetSHA256);
for (const model of longParity.models) {
  assert.equal(model.numericParity.steps, 171);
  assert(model.numericParity.maxAbsoluteError <= 1e-4);
}
const models = [...primary.models, ...control.models] as EvaluatedModel[];
for (const model of models) {
  assert.equal(model.cases.length, 221); assert.equal(model.training.epochs, 80);
  assert.equal(model.training.optimizerUpdates, 640); assert.equal(model.training.maskedTimestepsSeen, 264480);
  assert(model.numericParity.maxAbsoluteError <= 1e-4);
}
const names: Record<string, string> = {
  mlp: 'Mevcut MLP', gru: 'GRU', map: 'Harita + MLP',
  'residual-map-gru': 'Harita + GRU', 'capacity-mlp': 'Benzer kapasitede MLP',
};
const architectures = Object.keys(names).map(architecture => {
  const selected = models.filter(model => model.architecture === architecture);
  assert.deepEqual(selected.map(model => model.seed).sort((a, b) => a - b), [42, 123]);
  const bySplit = Object.fromEntries(['train', 'test-start', 'test-layout', 'test-room'].map(split => {
    const perSeed = selected.map(model => {
      const cases = model.cases.filter(result => result.split === split);
      return { seed: model.seed, solved: cases.filter(result => result.solved).length, total: cases.length };
    });
    const solved = perSeed.reduce((sum, result) => sum + result.solved, 0);
    const total = perSeed.reduce((sum, result) => sum + result.total, 0);
    return [split, { solved, total, rate: solved / total, perSeed }];
  }));
  const connectedRoomTests = selected.flatMap(model => model.cases).filter(result => result.taskFamily === 'chapter-7' && result.split !== 'train');
  return { architecture, name: names[architecture], parameterCount: selected[0].parameterCount, bySplit,
    connectedRoomTests: { solved: connectedRoomTests.filter(result => result.solved).length, total: connectedRoomTests.length },
    meanTrainingActionAccuracy: selected.reduce((sum, model) => sum + model.training.teacherForced.train.accuracy, 0) / selected.length,
    maxNumericalError: Math.max(...selected.map(model => model.numericParity.maxAbsoluteError)),
  };
});
const summary = {
  createdAt: new Date().toISOString(), status: 'passed', datasetSHA256: primary.datasetSHA256,
  experimentModels: models.length, totalRollouts: models.reduce((sum, model) => sum + model.cases.length, 0),
  seeds: [42, 123], epochs: 80, validTrainingStepsPerModel: 264480,
  aggregation: 'Counts sum two seeds over the same cases; these are not independent new room samples.',
  longSequenceParity: longParity, architectures,
};
await writeFile(root + '/summary.json', JSON.stringify(summary, null, 2) + '\n');
const fraction = (value: { solved: number; total: number }) => value.solved + '/' + value.total;
const rows = architectures.map(row => '| ' + [row.name, row.parameterCount,
  fraction(row.bySplit.train), fraction(row.bySplit['test-start']), fraction(row.bySplit['test-layout']),
  fraction(row.bySplit['test-room'])].join(' | ') + ' |');
const markdown = ['# Gerçek motor sonuçları', '',
  'Her hücre aynı koşulların iki başlangıç tohumu üzerindeki toplamıdır. Yeni odalar yedi farklı temel odadır; iki tohum toplamı 14 bağımsız oda anlamına gelmez.', '',
  '| Model | Parametre | Eğitim odaları | Yeni başlangıç | Tek duvar değişikliği | Yeni temel oda |',
  '|---|---:|---:|---:|---:|---:|', ...rows, '',
  'Her deneme en fazla 220 gerçek model kararı; otomatik çözüm veya düzeltme yok. Öğretim verileri çözüm sertifikalarıdır ve canlı oyuncu modeline verilmemiştir.', '',
  'Kapasite kontrolü ayrı ek deneydir. Telefon performansı ölçülmedi. Ayrıntılar: GRU_DENEYI.md.', ''].join('\n');
await writeFile(root + '/summary.md', markdown);
console.log(markdown);
