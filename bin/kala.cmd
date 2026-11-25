@echo off
REM Windows launcher. bin\kala prefers dist\index.js and falls back to src\index.ts.
node "%~dp0kala" %*
