param([switch]$ApkOnly, [switch]$Offline)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskNodeDirectory = Join-Path $taskRoot '.tools\node-v24.22.0-win-x64'
if (Test-Path -LiteralPath $taskNodeDirectory) { $env:Path = $taskNodeDirectory + ';' + $env:Path }
$taskJavaRoot = Join-Path $taskRoot '.tools\java'
if (Test-Path -LiteralPath $taskJavaRoot) { $env:JAVA_HOME = (Get-ChildItem -LiteralPath $taskJavaRoot -Directory | Select-Object -First 1).FullName }
$taskSdkRoot = Join-Path $taskRoot '.tools\android-sdk'
if (Test-Path -LiteralPath $taskSdkRoot) {
  $env:ANDROID_HOME = $taskSdkRoot
  [IO.File]::WriteAllText((Join-Path $taskRoot 'android\local.properties'), 'sdk.dir=' + $taskSdkRoot.Replace('\','/'))
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
& npx.cmd cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Android sync failed.' }
$taskGradleTasks = @('assembleDebug')
if (-not $ApkOnly) { $taskGradleTasks += 'bundleRelease' }
$taskGradleArguments = @('-p', 'android') + $taskGradleTasks + @('--max-workers=2', '--console=plain')
if ($Offline) { $taskGradleArguments += '--offline' }
& '.\android\gradlew.bat' @taskGradleArguments
if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
New-Item -ItemType Directory -Force -Path 'releases' | Out-Null
$taskPackage = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$taskReleaseBase = 'NOEMA-Duel-' + $taskPackage.version
$taskApk = Join-Path 'releases' ($taskReleaseBase + '-android.apk')
$taskBundle = Join-Path 'releases' ($taskReleaseBase + '-unsigned.aab')
Copy-Item -LiteralPath 'android\app\build\outputs\apk\debug\app-debug.apk' -Destination $taskApk -Force
$taskOutputs = @($taskApk)
if (-not $ApkOnly) {
  Copy-Item -LiteralPath 'android\app\build\outputs\bundle\release\app-release.aab' -Destination $taskBundle -Force
  $taskOutputs += $taskBundle
}
Get-FileHash -LiteralPath $taskOutputs -Algorithm SHA256
