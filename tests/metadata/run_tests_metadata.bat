@echo off
setlocal enableextensions
cd /d "%~dp0..\.."

REM Runs tests\metadata\ and writes a JUnit XML report under tests\__reports__\
REM Usage:
REM   tests\metadata\run_tests_metadata.bat
REM   tests\metadata\run_tests_metadata.bat /nopause

set "PY=python"
where py >nul 2>&1 && set "PY=py"

if not exist "tests\__reports__" mkdir "tests\__reports__" >nul 2>&1
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
set "REPORT=tests\__reports__\pytest_metadata_%TS%.xml"
set "HTML=tests\__reports__\pytest_metadata_%TS%.html"

echo [Majoor] Running: tests\metadata\
echo [Majoor] Report:  %REPORT%
%PY% -m pytest tests\metadata\ -v --tb=short --junitxml "%REPORT%"
set "EXITCODE=%errorlevel%"
%PY% scripts\junit_to_html.py "%REPORT%" "%HTML%" --title "Pytest Report - Metadata" --index-dir "tests\__reports__"

if /I "%~1"=="/nopause" goto :eof
pause
exit /b %EXITCODE%
