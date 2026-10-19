param(
  [int]$Epochs = 80,
  [int[]]$Seeds = @(42, 123),
  [int]$Threads = 2,
  [int]$ControlThreads = 1
)

$ErrorActionPreference = 'Stop'
$experimentRoot = Split-Path -Parent $PSScriptRoot
$experimentPython = Join-Path $experimentRoot '.tools\python-3.12.10\python.exe'
$experimentNode = Join-Path $experimentRoot '.tools\node-v24.22.0-win-x64\node.exe'
if (!(Test-Path -LiteralPath $experimentPython) -or !(Test-Path -LiteralPath $experimentNode)) {
  throw 'Bu çalışma alanındaki taşınabilir Python ve Node kurulumları gerekli.'
}

Push-Location -LiteralPath $experimentRoot
try {
  & $experimentPython -c "import torch; print('PyTorch', torch.__version__)"
  if ($LASTEXITCODE -ne 0) { throw 'PyTorch CPU kurulumu bulunamadı.' }
  & $experimentNode --import tsx scripts/export-gru-experiment.ts
  if ($LASTEXITCODE -ne 0) { throw 'Veri seti doğrulanamadı.' }
  $experimentArguments = @('scripts/train-gru-experiment.py', '--epochs', [string]$Epochs, '--seeds')
  $experimentArguments += @($Seeds | ForEach-Object { [string]$_ })
  $experimentArguments += @('--threads', [string]$Threads, '--batch-size', '16')
  & $experimentPython @experimentArguments
  if ($LASTEXITCODE -ne 0) { throw 'Model eğitimi tamamlanamadı.' }
  & $experimentNode --import tsx scripts/evaluate-gru-experiment.ts
  if ($LASTEXITCODE -ne 0) { throw 'Gerçek motor değerlendirmesi tamamlanamadı.' }
  $controlArguments = @('scripts/train-capacity-control.py', '--epochs', [string]$Epochs, '--seeds')
  $controlArguments += @($Seeds | ForEach-Object { [string]$_ })
  $controlArguments += @('--threads', [string]$ControlThreads, '--batch-size', '16')
  & $experimentPython @controlArguments
  if ($LASTEXITCODE -ne 0) { throw 'Kapasite kontrolü eğitilemedi.' }
  & $experimentNode --import tsx scripts/evaluate-gru-experiment.ts artifacts/gru-experiment/capacity-control artifacts/gru-experiment/dataset.json
  if ($LASTEXITCODE -ne 0) { throw 'Kapasite kontrolü değerlendirilemedi.' }
  & $experimentPython scripts/export-gru-long-parity.py
  if ($LASTEXITCODE -ne 0) { throw 'Uzun dizi kontrolü dışa aktarılamadı.' }
  & $experimentNode --import tsx scripts/evaluate-gru-experiment.ts artifacts/gru-experiment/long-parity artifacts/gru-experiment/dataset.json --parity-only
  if ($LASTEXITCODE -ne 0) { throw 'Uzun dizi sayısal eşitlik kontrolü başarısız.' }
  & $experimentNode --import tsx scripts/summarize-gru-experiment.ts
  if ($LASTEXITCODE -ne 0) { throw 'Deney raporları birleştirilemedi.' }
}
finally {
  Pop-Location
}
