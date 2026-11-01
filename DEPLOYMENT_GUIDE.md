# 🌐 Permanent Global Hosting & Deployment Guide

Quantum Alpha Trader can be run permanently in three different modes:

---

## 1. 🌍 Active Worldwide Live Link (Zero-Setup, Running Right Now)
Your platform is **already live on the public internet**:
- **Worldwide HTTPS URL:** [https://nexus-trader-live.loca.lt](https://nexus-trader-live.loca.lt)
- **First-Time Password:** `27.6.200.92` (enter when prompted on your phone or remote device)
- **Status:** Accessible from any iPhone, Android, MacBook, or PC on 4G/5G mobile networks worldwide.

---

## 2. 🏠 Local Wi-Fi Network Access (Instant Direct LAN, 0-Latency)
When connected to the same Wi-Fi at home or office:
- **Mobile URL:** [http://192.168.1.6:8000](http://192.168.1.6:8000)
- **Local PC URL:** [http://localhost:8000](http://localhost:8000)
- **Authentication:** Zero password needed, instant LAN connection.

---

## 3. ☁️ Permanent Cloud Deployment (24/7 Server without Keeping PC On)
If you want the terminal to run 24/7 in the cloud even when your personal computer is turned off:

### Option A: Free Deployment via Render (Recommended)
1. Push this codebase to your GitHub using the included `PUSH_TO_GITHUB.bat`.
2. Visit [Render.com](https://render.com) and click **New + > Web Service**.
3. Select your GitHub repository.
4. Configure:
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r backend/requirements.txt`
   - **Start Command:** `python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT`
5. Click **Create Web Service**. Render gives you a permanent free HTTPS URL (e.g., `https://quantum-alpha-trader.onrender.com`) that stays online 24/7!

### Option B: Free Deployment via Railway
1. Push to GitHub with `PUSH_TO_GITHUB.bat`.
2. Go to [Railway.app](https://railway.app) and click **Deploy from GitHub Repo**.
3. Railway automatically detects `main.py` and deploys your custom domain with SSL enabled.

---

## 4. 🔄 Windows 24/7 Auto-Boot on Your Computer
To make the platform automatically boot up silently in the background whenever your Windows PC turns on:
1. Double-click `INSTALL_WINDOWS_AUTO_STARTUP.bat`.
2. The platform will run in permanent background mode without opening any console window.
