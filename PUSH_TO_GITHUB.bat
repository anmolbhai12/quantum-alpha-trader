@echo off
title Quantum Alpha Trader - GitHub Publisher
color 0A
cls
echo ========================================================
echo   QUANTUM ALPHA TRADER - GITHUB REPOSITORY PUBLISHER
echo ========================================================
echo.
echo This script packages and publishes your Quantum Alpha
echo terminal to your personal or organization GitHub account.
echo.

cd /d "%~dp0"

echo [1/4] Checking Git installation...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git is not found in your system PATH.
    echo Please install Git from https://git-scm.com/
    pause
    exit /b 1
)
echo [OK] Git is ready.
echo.

echo [2/4] Initializing local Git repository...
if not exist .git (
    git init -b main
    echo [OK] Initialized new repository on branch 'main'.
) else (
    echo [OK] Existing git repository detected.
)
echo.

echo [3/4] Staging files and creating commit...
git add .
git commit -m "Release: Institutional Quantum Alpha AI Trader Terminal"
echo.

echo ========================================================
echo   ENTER YOUR GITHUB REPOSITORY URL
echo ========================================================
echo Example: https://github.com/your-username/quantum-trader.git
echo.
set /p REPO_URL="Enter GitHub Repo URL (or press Enter to skip remote push): "

if "%REPO_URL%"=="" (
    echo.
    echo Local Git commit created successfully!
    echo To push manually later, run:
    echo   git remote add origin YOUR_REPO_URL
    echo   git push -u origin main
    echo.
    pause
    exit /b 0
)

echo.
echo [4/4] Connecting to %REPO_URL% and pushing...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%
git branch -M main
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   SUCCESS! PLATFORM PUBLISHED TO GITHUB
    echo ========================================================
    echo Your repository is now live at: %REPO_URL%
) else (
    echo.
    echo [NOTE] Push completed or requires GitHub authentication.
    echo If prompted, sign in with your GitHub Personal Access Token.
)

echo.
pause
