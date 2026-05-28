@echo off
REM service-init-audit 실행 래퍼 (Windows 작업 스케줄러용)
REM 사용법: run_audit.bat morning  |  run_audit.bat evening
REM %~dp0 = 이 배치 파일이 있는 디렉토리 (끝에 \ 포함)

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set "SLOT=%~1"
if "%SLOT%"=="" set "SLOT=morning"

REM 로그 파일명에 날짜 (YYYYMMDD)
set "TODAY=%date:~0,4%%date:~5,2%%date:~8,2%"

"C:\Program Files\nodejs\node.exe" "%~dp0audit.js" --slot=%SLOT% >> "%~dp0logs\%TODAY%-%SLOT%.log" 2>&1
