"""
Quantum Alpha FastAPI Server
Serves real-time market data, AI signals, automated trade execution, and static UI.
"""

import os
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from market_engine import market_engine, MARKETS, EXCHANGE_RATES, CURRENCY_SYMBOLS
from trade_executor import trade_executor

app = FastAPI(title="Quantum Alpha Trader AI Engine", version="2.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request Models
class AIChatRequest(BaseModel):
    symbol: str
    message: str
    chat_history: Optional[List[Dict[str, Any]]] = None

class TradeRequest(BaseModel):
    symbol: str
    amount: float
    currency: str = "USD"
    side: str = "BUY"
    duration_seconds: int = 300
    target_pct: Optional[float] = 2.5
    stop_pct: Optional[float] = 1.2
    execution_mode: str = "SANDBOX" # "SANDBOX" or "LIVE_BROKER"

class BrokerConfigRequest(BaseModel):
    provider: str # "SANDBOX", "ALPACA", "ZERODHA", "ANGEL_ONE"
    alpaca_api_key: Optional[str] = ""
    alpaca_secret_key: Optional[str] = ""
    zerodha_api_key: Optional[str] = ""
    zerodha_access_token: Optional[str] = ""

class TrackRequest(BaseModel):
    symbol: str
    mode: str = "AI_SIGNALS" # "AI_SIGNALS", "PRICE_ABOVE", "PRICE_BELOW", "MOMENTUM_BREAKOUT"
    target_price: Optional[float] = None

import socket

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def get_public_tunnel_url():
    tunnel_file = os.path.join(os.path.dirname(__file__), "..", "tunnel_url.txt")
    if os.path.exists(tunnel_file):
        try:
            with open(tunnel_file, "r") as f:
                url = f.read().strip()
                if url.startswith("http"):
                    return url
        except Exception:
            pass
    return "https://nexus-trader-live.loca.lt"

# API Endpoints
@app.get("/api/system-info")
def get_system_info():
    lan_ip = get_lan_ip()
    pub_url = get_public_tunnel_url()
    return {
        "status": "ONLINE",
        "lan_ip": lan_ip,
        "port": 8000,
        "mobile_url": f"http://{lan_ip}:8000",
        "local_url": "http://localhost:8000",
        "public_url": pub_url,
        "tunnel_password": "27.6.200.92",
        "engine_mode": "PERMANENT_INSTITUTIONAL",
        "server_time": market_engine.last_fetch_time,
        "github_ready": True
    }

@app.get("/api/markets")
def get_markets():
    return {
        "markets": MARKETS,
        "exchange_rates": EXCHANGE_RATES,
        "currency_symbols": CURRENCY_SYMBOLS
    }

@app.get("/api/search")
def search_assets(q: str = Query(..., min_length=1)):
    results = market_engine.search_and_add_symbol(q)
    return {"results": results}

@app.get("/api/quotes")
def get_quotes(market: Optional[str] = "ALL"):
    all_quotes = market_engine.fetch_all_quotes()
    if market and market != "ALL":
        filtered = {k: v for k, v in all_quotes.items() if v.get("market") == market}
        return {"quotes": list(filtered.values()), "timestamp": market_engine.last_fetch_time}
    return {"quotes": list(all_quotes.values()), "timestamp": market_engine.last_fetch_time}

@app.get("/api/quote/{symbol}")
def get_symbol_detail(symbol: str, timeframe: Optional[str] = "15m"):
    quote = market_engine.get_quote(symbol)
    if not quote:
        market_engine.fetch_all_quotes()
        quote = market_engine.get_quote(symbol)
    if not quote:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    candles = market_engine.get_history(symbol, timeframe=timeframe or "15m")
    return {
        "quote": quote,
        "candles": candles,
        "timeframe": timeframe
    }

@app.get("/api/order-book/{symbol}")
def get_order_book_endpoint(symbol: str):
    return market_engine.get_order_book(symbol)

@app.get("/api/recent-trades/{symbol}")
def get_recent_trades_endpoint(symbol: str):
    return {"trades": market_engine.get_recent_trades(symbol)}

@app.post("/api/ai-chat")
def chat_with_market_ai(req: AIChatRequest):
    result = market_engine.answer_ai_query(
        symbol=req.symbol,
        query=req.message,
        chat_history=req.chat_history
    )
    return result

@app.get("/api/alerts")
def get_live_alerts():
    return {
        "alerts": market_engine.get_alerts(),
        "tracked": market_engine.get_tracked_targets()
    }

@app.post("/api/track")
def track_asset_endpoint(req: TrackRequest):
    info = market_engine.add_or_update_tracked_target(
        symbol=req.symbol.upper(),
        mode=req.mode,
        target_price=req.target_price
    )
    return {"success": True, "tracked": info, "all_tracked": market_engine.get_tracked_targets()}

@app.delete("/api/track/{symbol}")
def untrack_asset_endpoint(symbol: str):
    removed = market_engine.remove_tracked_target(symbol.upper())
    return {"success": removed, "all_tracked": market_engine.get_tracked_targets()}

@app.post("/api/test-alert")
def trigger_test_alert_endpoint(req: TrackRequest):
    alert = market_engine.trigger_test_alert(req.symbol.upper())
    return {"success": True, "alert": alert}

@app.get("/api/portfolio")
def get_portfolio(currency: str = "USD"):
    return trade_executor.get_portfolio_summary(display_currency=currency)

@app.post("/api/validate-order")
def validate_trade(req: TradeRequest):
    result = trade_executor.validate_order(
        symbol=req.symbol,
        amount=req.amount,
        currency=req.currency,
        side=req.side,
        duration_seconds=req.duration_seconds,
        target_pct=req.target_pct,
        stop_pct=req.stop_pct
    )
    return result

@app.post("/api/execute-trade")
def execute_trade(req: TradeRequest):
    try:
        position = trade_executor.execute_order(
            symbol=req.symbol,
            amount=req.amount,
            currency=req.currency,
            side=req.side,
            duration_seconds=req.duration_seconds,
            target_pct=req.target_pct,
            stop_pct=req.stop_pct,
            execution_mode=req.execution_mode
        )
        return {"success": True, "position": position, "message": f"Successfully opened {req.side} trade on {req.symbol}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/withdraw/{position_id}")
def withdraw_position(position_id: str):
    try:
        closed = trade_executor.withdraw_position(position_id, reason="MANUAL_WITHDRAWAL")
        return {"success": True, "trade": closed, "message": f"Withdrawn position {position_id} successfully."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/kill-switch")
def emergency_kill_switch():
    closed = trade_executor.kill_switch()
    return {"success": True, "closed_count": len(closed), "trades": closed}

@app.post("/api/broker/config")
def config_broker(req: BrokerConfigRequest):
    res = trade_executor.configure_broker(
        provider=req.provider,
        alpaca_key=req.alpaca_api_key or "",
        alpaca_secret=req.alpaca_secret_key or "",
        zerodha_key=req.zerodha_api_key or "",
        zerodha_token=req.zerodha_access_token or ""
    )
    return res

@app.post("/api/reset-portfolio")
def reset_portfolio():
    trade_executor.reset_balances()
    return {"success": True, "message": "Portfolio balance reset to initial values."}

# Mount static frontend
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    # Initial data warmup
    print("🚀 Initializing Quantum Alpha Market Intelligence Engine...")
    market_engine.fetch_all_quotes()
    print("✅ Ready! Starting server on http://localhost:8000")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
