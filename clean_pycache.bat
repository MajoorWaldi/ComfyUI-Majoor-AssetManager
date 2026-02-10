@echo off
setlocal
rem Delete all __pycache__ directories under this script's folder
set ROOT=%~dp0
echo Scanning for __pycache__ under: %ROOT%
for /d /r "%ROOT%" %%D in (__pycache__) do (
  if exist "%%D" (
    echo Deleting: %%D
    rmdir /s /q "%%D"
  )
)
echo Done.
endlocal
