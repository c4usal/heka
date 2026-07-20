@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
set "PATH=C:\Users\Ulofe\.cargo\bin;%PATH%"
npm.cmd run tauri:build
