@echo off
setlocal enableextensions
cd /d "%~dp0"

REM Default test runner (kept stable for convenience).
REM Delegates to the real runner under tests\ so all reports land in tests\__reports__\

call tests\run_tests_all.bat %*
