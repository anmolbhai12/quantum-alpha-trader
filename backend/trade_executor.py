"""
Quantum Alpha Automated Trade Execution & Capital Management Engine
Handles real-time position management, dynamic P&L calculations, automated time-based
and target-based exits/withdrawals, and Live Broker Gateway (Alpaca / Zerodha / Angel One).
"""

import time
import uuid
import threading
import json
import os
import requests
from typing import Dict, List, Any, Optional
from market_engine import market_engine, EXCHANGE_RATES

LEDGER_FILE = os.path.join(os.path.dirname(__file__), "trade_ledger.json")

class TradeExecutionEngine:
    def __init__(self):
        self.lock = threading.Lock()
        
        # Portfolio Balances for all major world currencies
        self.balances = {
            "USD": 50000.0,
            "INR": 4000000.0,
            "EUR": 45000.0,
            "GBP": 39000.0,
            "JPY": 7500000.0,
            "AED": 180000.0,
            "CAD": 68000.0,
            "AUD": 75000.0,
            "CHF": 42000.0,
            "SGD": 65000.0,
            "CNY": 350000.0,
            "SAR": 185000.0,
            "HKD": 390000.0
        }
        
        self.initial_balances = self.balances.copy()
        self.active_positions: Dict[str, Dict[str, Any]] = {}
        self.closed_trades: List[Dict[str, Any]] = []
        
        # Broker configurations (configurable via UI)
        self.broker_config = {
            "provider": "SANDBOX", # "SANDBOX", "ALPACA", "ZERODHA", "ANGEL_ONE"
            "alpaca_api_key": "",
            "alpaca_secret_key": "",
            "alpaca_endpoint": "https://paper-api.alpaca.markets",
            "zerodha_api_key": "",
            "zerodha_access_token": "",
            "is_live_broker_active": False
        }
        
        self._load_ledger()
        
        # Start background position monitoring & automated exit daemon
        self.running = True
        self.monitor_thread = threading.Thread(target=self._exit_monitor_loop, daemon=True)
        self.monitor_thread.start()

    def _load_ledger(self):
        if os.path.exists(LEDGER_FILE):
            try:
                with open(LEDGER_FILE, "r") as f:
                    data = json.load(f)
                    self.balances = data.get("balances", self.balances)
                    self.closed_trades = data.get("closed_trades", [])
            except Exception as e:
                print(f"Error loading ledger: {e}")

    def _save_ledger(self):
        try:
            with open(LEDGER_FILE, "w") as f:
                json.dump({
                    "balances": self.balances,
                    "closed_trades": self.closed_trades[-100:] # keep last 100
                }, f, indent=2)
        except Exception as e:
            print(f"Error saving ledger: {e}")

    def validate_order(self, symbol: str, amount: float, currency: str = "USD",
                       side: str = "BUY", duration_seconds: int = 300,
                       target_pct: Optional[float] = None, stop_pct: Optional[float] = None) -> Dict[str, Any]:
        """
        Pre-flight risk and validation check before order execution.
        Returns detailed execution breakdown or raises errors if safeguards fail.
        """
        errors = []
        warnings_list = []
        
        # 1. Check Symbol
        quote = market_engine.get_quote(symbol)
        if not quote:
            errors.append(f"Invalid or unreachable ticker symbol: '{symbol}'. Live market quote could not be verified.")
            return {"valid": False, "errors": errors, "warnings": warnings_list}

        # 2. Check Allocation & Balance
        if amount <= 0:
            errors.append("Order capital allocation must be greater than 0.00.")
        
        avail_balance = self.balances.get(currency, 0.0)
        if amount > avail_balance:
            errors.append(
                f"Insufficient capital: Account has {currency} {avail_balance:,.2f} available, but order requires {currency} {amount:,.2f}."
            )

        # 3. Check Duration
        if duration_seconds < 10:
            errors.append("Holding duration must be at least 10 seconds to allow orderly order routing.")
        elif duration_seconds > 2592000: # 30 days
            errors.append("Holding duration exceeds maximum automated timer ceiling (30 days).")

        # 4. Check Targets & Stop Losses
        t_pct = target_pct if target_pct is not None else 2.5
        s_pct = stop_pct if stop_pct is not None else 1.2

        if t_pct <= 0:
            errors.append("Take-profit target percentage must be strictly positive.")
        if s_pct <= 0:
            errors.append("Stop-loss risk boundary must be strictly positive.")

        # Risk / Reward evaluation
        rr_ratio = round(t_pct / s_pct, 2) if s_pct > 0 else 0.0
        if rr_ratio < 1.0:
            warnings_list.append(f"Asymmetrical risk-reward ratio ({rr_ratio}:1). Potential risk exceeds profit target.")

        if errors:
            return {
                "valid": False,
                "errors": errors,
                "warnings": warnings_list
            }

        # Calculation breakdown
        entry_price = quote["price"]
        slippage = entry_price * 0.0002 if side == "BUY" else -entry_price * 0.0002
        est_fill = round(entry_price + slippage, 2)
        est_units = round(amount / est_fill, 4)

        if side == "BUY":
            target_price = round(est_fill * (1 + t_pct / 100), 2)
            stop_price = round(est_fill * (1 - s_pct / 100), 2)
        else:
            target_price = round(est_fill * (1 - t_pct / 100), 2)
            stop_price = round(est_fill * (1 + s_pct / 100), 2)

        est_gain = round(amount * (t_pct / 100), 2)
        est_loss = round(amount * (s_pct / 100), 2)

        return {
            "valid": True,
            "errors": [],
            "warnings": warnings_list,
            "symbol": symbol,
            "company_name": quote["name"],
            "market": quote["market"],
            "currency": currency,
            "side": side,
            "allocated_capital": amount,
            "estimated_fill_price": est_fill,
            "estimated_units": est_units,
            "target_price": target_price,
            "target_pct": t_pct,
            "estimated_gain": est_gain,
            "stop_loss_price": stop_price,
            "stop_pct": s_pct,
            "estimated_loss": est_loss,
            "risk_reward_ratio": rr_ratio,
            "duration_seconds": duration_seconds,
            "duration_formatted": f"{int(duration_seconds // 60)}m {int(duration_seconds % 60)}s" if duration_seconds < 3600 else f"{round(duration_seconds / 3600, 1)} hours"
        }

    def execute_order(self, symbol: str, amount: float, currency: str = "USD",
                      side: str = "BUY", duration_seconds: int = 300,
                      target_pct: Optional[float] = None, stop_pct: Optional[float] = None,
                      execution_mode: str = "SANDBOX") -> Dict[str, Any]:
        """
        Executes a trade order, locks the allocation, sets the automated withdrawal timer,
        and manages target/stop-loss triggers.
        """
        with self.lock:
            # 1. Validate balance
            avail_balance = self.balances.get(currency, 0.0)
            if amount <= 0:
                raise ValueError("Investment amount must be greater than 0.")
            if amount > avail_balance:
                raise ValueError(f"Insufficient {currency} balance! Available: {avail_balance:,.2f}, Requested: {amount:,.2f}")

            # 2. Get current live price from engine
            quote = market_engine.get_quote(symbol)
            if not quote:
                raise ValueError(f"Unable to fetch live quote for {symbol}")
            
            entry_price = quote["price"]
            # Slippage simulation (0.02% realistic institutional fill)
            slippage = entry_price * 0.0002 if side == "BUY" else -entry_price * 0.0002
            fill_price = round(entry_price + slippage, 2)
            
            # Asset quantity
            quantity = amount / fill_price

            # Target & Stop-loss prices
            if target_pct is None: target_pct = 2.5
            if stop_pct is None: stop_pct = 1.2
            
            if side == "BUY":
                target_price = round(fill_price * (1 + target_pct / 100), 2)
                stop_loss_price = round(fill_price * (1 - stop_pct / 100), 2)
            else: # SELL / SHORT
                target_price = round(fill_price * (1 - target_pct / 100), 2)
                stop_loss_price = round(fill_price * (1 + stop_pct / 100), 2)

            now = time.time()
            exit_time = now + duration_seconds
            position_id = str(uuid.uuid4())[:8].upper()

            # Broker API execution if Live Broker selected
            broker_order_id = None
            if execution_mode == "LIVE_BROKER" and self.broker_config["is_live_broker_active"]:
                broker_order_id = self._send_to_broker(symbol, quantity, side)

            # Deduct balance
            self.balances[currency] -= amount

            position = {
                "id": position_id,
                "symbol": symbol,
                "name": quote["name"],
                "market": quote["market"],
                "currency": currency,
                "side": side,
                "entry_price": fill_price,
                "current_price": fill_price,
                "quantity": round(quantity, 4),
                "invested_amount": round(amount, 2),
                "duration_seconds": duration_seconds,
                "entry_time": now,
                "exit_time": exit_time,
                "time_remaining": duration_seconds,
                "target_price": target_price,
                "stop_loss_price": stop_loss_price,
                "target_pct": target_pct,
                "stop_pct": stop_pct,
                "execution_mode": execution_mode,
                "broker_order_id": broker_order_id,
                "unrealized_pnl": 0.0,
                "unrealized_pnl_pct": 0.0,
                "status": "ACTIVE"
            }

            self.active_positions[position_id] = position
            self._save_ledger()

            return position

    def withdraw_position(self, position_id: str, reason: str = "MANUAL_WITHDRAWAL") -> Dict[str, Any]:
        """Liquidate position immediately and credit capital + profit/loss back to balance."""
        with self.lock:
            if position_id not in self.active_positions:
                raise ValueError("Position not found or already closed.")

            pos = self.active_positions.pop(position_id)
            quote = market_engine.get_quote(pos["symbol"])
            exit_price = quote["price"] if quote else pos["current_price"]

            # Calculate Final Realized PnL
            if pos["side"] == "BUY":
                pnl = (exit_price - pos["entry_price"]) * pos["quantity"]
            else:
                pnl = (pos["entry_price"] - exit_price) * pos["quantity"]

            pnl_pct = (pnl / pos["invested_amount"]) * 100 if pos["invested_amount"] > 0 else 0.0
            total_returned = pos["invested_amount"] + pnl

            # Credit back balance
            curr = pos["currency"]
            self.balances[curr] = round(self.balances.get(curr, 0.0) + total_returned, 2)

            closed_trade = {
                "id": pos["id"],
                "symbol": pos["symbol"],
                "name": pos["name"],
                "currency": curr,
                "side": pos["side"],
                "entry_price": pos["entry_price"],
                "exit_price": exit_price,
                "quantity": pos["quantity"],
                "invested_amount": pos["invested_amount"],
                "total_returned": round(total_returned, 2),
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 2),
                "entry_time": pos["entry_time"],
                "exit_time": time.time(),
                "duration_held_seconds": int(time.time() - pos["entry_time"]),
                "reason": reason, # "DURATION_EXPIRED", "TAKE_PROFIT_HIT", "STOP_LOSS_HIT", "MANUAL_WITHDRAWAL"
                "execution_mode": pos["execution_mode"]
            }

            self.closed_trades.insert(0, closed_trade)
            self._save_ledger()
            return closed_trade

    def kill_switch(self) -> List[Dict[str, Any]]:
        """Emergency liquidate all open positions instantly."""
        results = []
        pos_ids = list(self.active_positions.keys())
        for pid in pos_ids:
            try:
                res = self.withdraw_position(pid, reason="EMERGENCY_KILL_SWITCH")
                results.append(res)
            except Exception as e:
                print(f"Error closing {pid}: {e}")
        return results

    def reset_balances(self):
        with self.lock:
            self.balances = self.initial_balances.copy()
            self.active_positions.clear()
            self._save_ledger()

    def _exit_monitor_loop(self):
        """High-frequency background monitor that triggers automated timer exits and TP/SL."""
        while self.running:
            try:
                now = time.time()
                positions_to_close = []

                with self.lock:
                    for pid, pos in list(self.active_positions.items()):
                        quote = market_engine.get_quote(pos["symbol"])
                        if quote:
                            curr_price = quote["price"]
                            pos["current_price"] = curr_price
                            
                            # Update PnL
                            if pos["side"] == "BUY":
                                pnl = (curr_price - pos["entry_price"]) * pos["quantity"]
                            else:
                                pnl = (pos["entry_price"] - curr_price) * pos["quantity"]
                            
                            pos["unrealized_pnl"] = round(pnl, 2)
                            pos["unrealized_pnl_pct"] = round((pnl / pos["invested_amount"]) * 100, 2)

                        # Update countdown
                        pos["time_remaining"] = max(0, int(pos["exit_time"] - now))

                        # 1. Timer Expiration Check
                        if now >= pos["exit_time"]:
                            positions_to_close.append((pid, "TIMER_DURATION_EXPIRED"))
                            continue

                        # 2. Take Profit Check
                        if pos["side"] == "BUY" and pos["current_price"] >= pos["target_price"]:
                            positions_to_close.append((pid, "TAKE_PROFIT_AUTO_EXIT"))
                            continue
                        elif pos["side"] == "SELL" and pos["current_price"] <= pos["target_price"]:
                            positions_to_close.append((pid, "TAKE_PROFIT_AUTO_EXIT"))
                            continue

                        # 3. Stop Loss Check
                        if pos["side"] == "BUY" and pos["current_price"] <= pos["stop_loss_price"]:
                            positions_to_close.append((pid, "STOP_LOSS_PROTECTION_EXIT"))
                            continue
                        elif pos["side"] == "SELL" and pos["current_price"] >= pos["stop_loss_price"]:
                            positions_to_close.append((pid, "STOP_LOSS_PROTECTION_EXIT"))
                            continue

                # Close outside lock to prevent deadlock
                for pid, reason in positions_to_close:
                    try:
                        self.withdraw_position(pid, reason=reason)
                        print(f"🤖 AI Automated Exit triggered for Position {pid}: {reason}")
                    except Exception as e:
                        print(f"Error auto-closing position {pid}: {e}")

            except Exception as e:
                print(f"Monitor loop error: {e}")

            time.sleep(1.0) # Check every 1 second for razor-sharp execution

    def configure_broker(self, provider: str, alpaca_key: str = "", alpaca_secret: str = "",
                         zerodha_key: str = "", zerodha_token: str = "") -> Dict[str, Any]:
        """Configure live broker credentials."""
        with self.lock:
            self.broker_config["provider"] = provider
            self.broker_config["alpaca_api_key"] = alpaca_key
            self.broker_config["alpaca_secret_key"] = alpaca_secret
            self.broker_config["zerodha_api_key"] = zerodha_key
            self.broker_config["zerodha_access_token"] = zerodha_token
            
            # Test Alpaca if provided
            if provider == "ALPACA" and alpaca_key and alpaca_secret:
                try:
                    headers = {
                        "APCA-API-KEY-ID": alpaca_key,
                        "APCA-API-SECRET-KEY": alpaca_secret
                    }
                    r = requests.get(f"{self.broker_config['alpaca_endpoint']}/v2/account", headers=headers, timeout=5)
                    if r.status_code == 200:
                        acc = r.json()
                        self.broker_config["is_live_broker_active"] = True
                        return {
                            "status": "CONNECTED",
                            "provider": "ALPACA",
                            "buying_power": acc.get("buying_power"),
                            "cash": acc.get("cash"),
                            "status_msg": "Alpaca API Authenticated Successfully!"
                        }
                    else:
                        return {"status": "FAILED", "error": f"Alpaca rejected key: HTTP {r.status_code}"}
                except Exception as e:
                    return {"status": "FAILED", "error": str(e)}

            return {
                "status": "CONFIGURED",
                "provider": provider,
                "is_live_broker_active": provider != "SANDBOX"
            }

    def _send_to_broker(self, symbol: str, quantity: float, side: str) -> Optional[str]:
        """Dispatch live market order to broker gateway."""
        if self.broker_config["provider"] == "ALPACA":
            try:
                headers = {
                    "APCA-API-KEY-ID": self.broker_config["alpaca_api_key"],
                    "APCA-API-SECRET-KEY": self.broker_config["alpaca_secret_key"],
                    "Content-Type": "application/json"
                }
                payload = {
                    "symbol": symbol,
                    "qty": round(quantity, 2),
                    "side": side.lower(),
                    "type": "market",
                    "time_in_force": "day"
                }
                r = requests.post(f"{self.broker_config['alpaca_endpoint']}/v2/orders", headers=headers, json=payload, timeout=5)
                if r.status_code in [200, 201]:
                    return r.json().get("id")
            except Exception as e:
                print(f"Broker order dispatch error: {e}")
        return None

    def get_portfolio_summary(self, display_currency: str = "USD") -> Dict[str, Any]:
        """Returns consolidated portfolio metrics, active positions, and recent trades."""
        with self.lock:
            cash = self.balances.get(display_currency, 0.0)
            
            total_invested = sum(
                p["invested_amount"] * (EXCHANGE_RATES.get(display_currency, 1.0) / EXCHANGE_RATES.get(p["currency"], 1.0))
                for p in self.active_positions.values()
            )
            
            total_unrealized_pnl = sum(
                p["unrealized_pnl"] * (EXCHANGE_RATES.get(display_currency, 1.0) / EXCHANGE_RATES.get(p["currency"], 1.0))
                for p in self.active_positions.values()
            )

            total_realized_pnl = sum(
                t["pnl"] * (EXCHANGE_RATES.get(display_currency, 1.0) / EXCHANGE_RATES.get(t["currency"], 1.0))
                for t in self.closed_trades
            )

            equity = cash + total_invested + total_unrealized_pnl
            win_trades = [t for t in self.closed_trades if t["pnl"] > 0]
            win_rate = (len(win_trades) / len(self.closed_trades) * 100) if self.closed_trades else 0.0

            return {
                "display_currency": display_currency,
                "cash": round(cash, 2),
                "total_invested": round(total_invested, 2),
                "total_unrealized_pnl": round(total_unrealized_pnl, 2),
                "total_realized_pnl": round(total_realized_pnl, 2),
                "net_equity": round(equity, 2),
                "win_rate": round(win_rate, 1),
                "total_trades_count": len(self.closed_trades),
                "active_positions_count": len(self.active_positions),
                "active_positions": list(self.active_positions.values()),
                "closed_trades": self.closed_trades[:25],
                "broker_status": {
                    "provider": self.broker_config["provider"],
                    "is_live_broker_active": self.broker_config["is_live_broker_active"]
                }
            }

trade_executor = TradeExecutionEngine()
