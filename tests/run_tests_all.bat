@echo off
setlocal enableextensions
cd /d "%~dp0.."

REM Full test suite + JUnit XML report under tests\__reports__\
REM Usage:
REM   run_tests_all.bat
REM   run_tests_all.bat /nopause

set "PY=python"
where py >nul 2>&1 && set "PY=py"

if not exist "tests\__reports__" mkdir "tests\__reports__" >nul 2>&1

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
set "REPORT=tests\__reports__\pytest_all_%TS%.xml"
set "HTML=tests\__reports__\pytest_all_%TS%.html"

echo [Majoor] Running: all tests
echo [Majoor] Report:  %REPORT%
%PY% -m pytest tests/ -v --tb=short --junitxml "%REPORT%"
set "EXITCODE=%errorlevel%"
%PY% scripts\junit_to_html.py "%REPORT%" "%HTML%" --title "Pytest Report - All" --index-dir "tests\__reports__"

if /I "%~1"=="/nopause" exit /b %EXITCODE%
pause
exit /b %EXITCODE%
