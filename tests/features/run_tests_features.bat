@echo off
setlocal enableextensions
cd /d "%~dp0..\.."

REM Runs tests\features\ and writes a JUnit XML report under tests\__reports__\
REM Usage:
REM   tests\features\run_tests_features.bat
REM   tests\features\run_tests_features.bat /nopause

set "PY=python"
where py >nul 2>&1 && set "PY=py"

if not exist "tests\__reports__" mkdir "tests\__reports__" >nul 2>&1
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
set "REPORT=tests\__reports__\pytest_features_%TS%.xml"
set "HTML=tests\__reports__\pytest_features_%TS%.html"

echo [Majoor] Running: tests\features\
echo [Majoor] Report:  %REPORT%
%PY% -m pytest tests\features\ -v --tb=short --junitxml "%REPORT%"
set "EXITCODE=%errorlevel%"
%PY% scripts\junit_to_html.py "%REPORT%" "%HTML%" --title "Pytest Report - Features" --index-dir "tests\__reports__"

if /I "%~1"=="/nopause" goto :eof
pause
exit /b %EXITCODE%
