@echo off
rem Starts the Budget Planner server.
rem Uses Node from the PATH if it is there, otherwise the per-user install.
setlocal
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "NODE=%LOCALAPPDATA%\Programs\node\node.exe"
if not defined NODE (
  echo.
  echo   Node.js 22.5 or newer was not found.
  echo   Install it from https://nodejs.org and run this again.
  echo.
  exit /b 1
)
"%NODE%" "%~dp0src\server.js" %*
