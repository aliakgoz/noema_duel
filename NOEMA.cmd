@echo off
setlocal
cd /d "%~dp0"
if exist ".tools\node-v24.22.0-win-x64\node.exe" (
  ".tools\node-v24.22.0-win-x64\node.exe" --import tsx server\start.ts
) else (
  node --import tsx server\start.ts
)
