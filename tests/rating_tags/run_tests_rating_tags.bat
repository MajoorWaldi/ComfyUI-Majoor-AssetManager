@echo off
setlocal enableextensions
cd /d "%~dp0..\.."

REM Runs tests\rating_tags\ and writes a JUnit XML report under tests\__reports__\
REM Usage:
REM   tests\rating_tags\run_tests_rating_tags.bat
REM   tests\rating_tags\run_tests_rating_tags.bat /nopause

set "PY=python"
where py >nul 2>&1 && set "PY=py"

if not exist "tests\__reports__" mkdir "tests\__reports__" >nul 2>&1
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
set "REPORT=tests\__reports__\pytest_rating_tags_%TS%.xml"
set "HTML=tests\__reports__\pytest_rating_tags_%TS%.html"

echo [Majoor] Running: tests\rating_tags\
echo [Majoor] Report:  %REPORT%
%PY% -m pytest tests\rating_tags\ -v --tb=short --junitxml "%REPORT%"
set "EXITCODE=%errorlevel%"
%PY% scripts\junit_to_html.py "%REPORT%" "%HTML%" --title "Pytest Report - Rating/Tags" --index-dir "tests\__reports__"

if /I "%~1"=="/nopause" goto :eof
pause
exit /b %EXITCODE%
