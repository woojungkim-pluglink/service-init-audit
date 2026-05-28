@echo off
REM service-init-audit evening slot — Windows 작업 스케줄러용 (인자 불필요)
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
set "TODAY=%date:~0,4%%date:~5,2%%date:~8,2%"
"C:\Program Files\nodejs\node.exe" "%~dp0audit.js" --slot=evening >> "%~dp0logs\%TODAY%-evening.log" 2>&1
