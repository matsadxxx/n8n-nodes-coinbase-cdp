import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Any
from contextlib import asynccontextmanager
import asyncio # Added for event loop access

import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException, Query, Body, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.bybit_client import get_bybit_client, fetch_historical_klines
from app.fvg_logic import detect_fvgs
from app.backtester import run_backtest
from app.metrics import calculate_performance_metrics
from app.websocket_service import RealtimeFVGDetector

from pydantic import BaseModel

class BacktestRequest(BaseModel):
    symbol: str
    interval: str
    category: str = "spot"
    start_date: str
    end_date: str
    initial_balance: float = 10000.0
    risk_per_trade_percent: float = 1.0
    auto_threshold_fvg: bool = True
    rr_ratio_override: Optional[float] = None
    commission_percent: float = 0.0
    risk_free_rate_annual: float = 0.0

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

bybit_http_client: Optional[Any] = None
main_event_loop: Optional[asyncio.AbstractEventLoop] = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, key: str):
        await websocket.accept()
        if key not in self.active_connections:
            self.active_connections[key] = []
        self.active_connections[key].append(websocket)
        logging.info(f"Client connected to WebSocket for {key}. Total clients: {len(self.active_connections[key])}")

    def disconnect(self, websocket: WebSocket, key: str):
        if key in self.active_connections:
            try:
                self.active_connections[key].remove(websocket)
                logging.info(f"Client disconnected from WebSocket for {key}. Remaining clients: {len(self.active_connections[key]) if key in self.active_connections and self.active_connections[key] else 0}")
                if key in self.active_connections and not self.active_connections[key]: # Check if list is empty after removal
                    del self.active_connections[key]
            except ValueError:
                logging.warning(f"WebSocket instance not found in active connections for key {key} during disconnect (already removed?).")
        else:
            logging.warning(f"Attempted to disconnect WebSocket for unknown key {key} (no active connections for this key).")

    async def broadcast_to_key(self, key: str, message: str):
        if key in self.active_connections:
            # logging.debug(f"Broadcasting to {len(self.active_connections[key])} clients for key {key}: {message}")
            for connection in list(self.active_connections[key]):
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logging.error(f"Error sending message to client for {key}: {e}. Removing problematic connection.")
                    try:
                        self.active_connections[key].remove(connection)
                        if not self.active_connections[key]:
                           del self.active_connections[key]
                    except ValueError: # Already removed
                        pass


websocket_manager = ConnectionManager()
detector_instances: Dict[str, RealtimeFVGDetector] = {}
detector_locks: Dict[str, asyncio.Lock] = {} # Stores {key: asyncio.Lock()} for detector creation/deletion


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    global bybit_http_client, main_event_loop
    main_event_loop = asyncio.get_running_loop()
    logging.info("Application startup: Initializing Bybit client...")
    try:
        bybit_http_client = get_bybit_client()
        if bybit_http_client is None:
            logging.error("Fatal: Failed to initialize Bybit HTTP client during startup.")
        else:
            logging.info("Bybit HTTP client initialized successfully via lifespan event.")
    except Exception as e:
        logging.error(f"Fatal: Exception during Bybit HTTP client initialization: {e}", exc_info=True)

    yield

    logging.info("Application shutdown: Cleaning up resources...")
    detector_keys = list(detector_instances.keys())
    for key in detector_keys:
        # Use the specific lock for this key to ensure safe removal
        lock = detector_locks.get(key)
        if lock:
            async with lock:
                detector = detector_instances.pop(key, None)
                if detector:
                    logging.info(f"Lifespan: Stopping detector for {key}...")
                    await detector.stop()
                # Remove the lock as the detector is now gone
                detector_locks.pop(key, None)
        else: # Should not happen if locks are managed consistently
            detector = detector_instances.pop(key, None)
            if detector:
                logging.warning(f"Lifespan: Stopping detector for {key} without a lock...")
                await detector.stop()

    logging.info("All FVG detectors stopped and locks removed.")

app = FastAPI(title="FVGrab API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR_PRIMARY = "app/static"
STATIC_DIR_FALLBACK = "static"
# Attempt to mount static files, prioritizing the primary path.
# Path for static files is relative to where uvicorn is run.
# If running from project root `fvgrab_app/`, then `app/static` is correct.
try:
    app.mount("/static", StaticFiles(directory=STATIC_DIR_PRIMARY), name="static_primary")
    logging.info(f"Static files mounted from '{STATIC_DIR_PRIMARY}'.")
except RuntimeError:
    try:
        app.mount("/static", StaticFiles(directory=STATIC_DIR_FALLBACK), name="static_fallback")
        logging.info(f"Static files mounted from '{STATIC_DIR_FALLBACK}'.")
    except RuntimeError as e_inner:
        logging.warning(f"Could not mount static directory from '{STATIC_DIR_PRIMARY}' or '{STATIC_DIR_FALLBACK}': {e_inner}. This may be expected if no static UI is part of this deployment.")


def date_str_to_ms(date_str: str) -> int:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    dt_utc = dt.replace(tzinfo=timezone.utc)
    return int(dt_utc.timestamp() * 1000)

def end_date_str_to_ms(date_str: str) -> int:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    dt_utc_end_of_day = datetime(dt.year, dt.month, dt.day, 23, 59, 59, 999000, tzinfo=timezone.utc)
    return int(dt_utc_end_of_day.timestamp() * 1000)

@app.get("/")
async def read_root():
    return {"message": "Welcome to FVGrab - FVG Analysis Dashboard API"}

@app.get("/api/health")
async def health_check():
    if bybit_http_client is None:
        return {"status": "unhealthy", "reason": "Bybit HTTP client not initialized"}
    try:
        server_time_resp = bybit_http_client.get_server_time()
        if server_time_resp and server_time_resp.get('retCode') == 0:
            return {"status": "ok", "bybit_client_initialized": True, "bybit_server_time_utc_ms": int(server_time_resp['result']['timeNano']) // 1000000}
        else:
            logging.warning(f"Bybit client ping failed during health check: {server_time_resp.get('retMsg')}")
            return {"status": "unhealthy", "reason": "Bybit client ping failed", "details": server_time_resp.get('retMsg')}
    except Exception as e:
        logging.error(f"Health check Bybit ping exception: {e}", exc_info=True)
        return {"status": "unhealthy", "reason": "Bybit client ping failed", "error": str(e)}

@app.get("/api/historical-fvg", summary="Fetch historical Fair Value Gaps")
async def get_historical_fvgs_endpoint(
    symbol: str = Query(..., description="Trading symbol, e.g., BTCUSDT"),
    interval: str = Query(..., description="Kline interval, e.g., 15, 60, D"),
    category: str = Query(default="spot", description="Category: spot, linear, inverse"),
    start_date: str = Query(..., description="Start date in YYYY-MM-DD format (inclusive)"),
    end_date: str = Query(..., description="End date in YYYY-MM-DD format (inclusive)"),
    auto_threshold: bool = Query(True, description="Use auto threshold for FVG detection")
):
    if not bybit_http_client:
        raise HTTPException(status_code=503, detail="Bybit client not available. Service may be starting up or encountered an error.")
    try:
        start_ms = date_str_to_ms(start_date)
        end_ms = end_date_str_to_ms(end_date)
        if start_ms >= end_ms:
            raise HTTPException(status_code=400, detail="Start date must be before end date.")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    logging.info(f"Request for historical FVGs: {symbol}, Interval: {interval}, Category: {category}, From: {start_date} To: {end_date}")

    try:
        kline_df = fetch_historical_klines(
            client=bybit_http_client, category=category, symbol=symbol,
            interval=interval, start_time_ms=start_ms, end_time_ms=end_ms
        )
    except Exception as e:
        logging.error(f"Error fetching klines for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch kline data from Bybit for {symbol}: {str(e)}")

    if kline_df.empty:
        logging.warning(f"No kline data found for {symbol} from {start_date} to {end_date}.")
        return []

    fvgs = detect_fvgs(kline_df, auto_threshold=auto_threshold)
    # Convert datetime objects in FVGs to ISO format strings for JSON serialization
    for fvg in fvgs: # fvgs is a list of dicts
        for key_dt, value_dt in fvg.items():
            if isinstance(value_dt, (datetime, pd.Timestamp)):
                fvg[key_dt] = value_dt.isoformat()
    logging.info(f"Detected {len(fvgs)} FVGs for {symbol} from {start_date} to {end_date}.")
    return fvgs


@app.post("/api/backtest", summary="Run FVG Backtest")
async def run_fvg_backtest_endpoint(request: BacktestRequest):
    if not bybit_http_client:
        raise HTTPException(status_code=503, detail="Bybit client not available.")
    try:
        start_ms = date_str_to_ms(request.start_date)
        end_ms = end_date_str_to_ms(request.end_date)
        if start_ms >= end_ms:
            raise HTTPException(status_code=400, detail="Start date must be before end date.")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format for start_date or end_date. Use YYYY-MM-DD.")

    logging.info(f"Backtest request for {request.symbol}, Interval: {request.interval}, Category: {request.category}, From: {request.start_date} To: {request.end_date}")

    try:
        kline_df = fetch_historical_klines(
            client=bybit_http_client, category=request.category, symbol=request.symbol,
            interval=request.interval, start_time_ms=start_ms, end_time_ms=end_ms
        )
    except Exception as e:
        logging.error(f"Error fetching klines for backtest ({request.symbol}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch kline data for backtest ({request.symbol}): {str(e)}")

    if kline_df.empty:
        raise HTTPException(status_code=404, detail=f"No kline data found for {request.symbol} from {request.start_date} to {request.end_date} to run backtest.")

    fvg_signals = detect_fvgs(kline_df, auto_threshold=request.auto_threshold_fvg)
    if not fvg_signals:
        logging.warning(f"No FVG signals detected for {request.symbol} in the period. Backtest will result in no trades.")
        empty_metrics = calculate_performance_metrics([], request.initial_balance, request.risk_free_rate_annual)
        return {
            "request_params": request.dict(),
            "fvg_signals_count": 0,
            "trades": [],
            "performance_metrics": empty_metrics,
            "message": "No FVG signals detected, so no trades were executed."
        }

    backtest_results = run_backtest(
        kline_df=kline_df,
        fvg_signals=fvg_signals,
        initial_balance=request.initial_balance,
        risk_per_trade_percent=request.risk_per_trade_percent,
        rr_ratio_override=request.rr_ratio_override,
        commission_percent=request.commission_percent
    )

    performance_metrics = calculate_performance_metrics(
        trades=backtest_results['trades'],
        initial_balance=request.initial_balance,
        risk_free_rate_annual=request.risk_free_rate_annual
    )

    # Convert datetime objects in trades to ISO format strings for JSON serialization
    for trade in backtest_results['trades']: # trades is a list of dicts
        for key_dt, value_dt in trade.items():
            if isinstance(value_dt, (datetime, pd.Timestamp)):
                trade[key_dt] = value_dt.isoformat()

    logging.info(f"Backtest for {request.symbol} completed. Trades: {len(backtest_results['trades'])}, Final Balance: {backtest_results['final_balance']:.2f}")

    return {
        "request_params": request.dict(),
        "fvg_signals_count": len(fvg_signals),
        "trades": backtest_results['trades'],
        "performance_metrics": performance_metrics
    }

@app.get("/api/scan-fvgs", summary="Scan multiple symbols for recent FVGs")
async def scan_market_for_fvgs_endpoint(
    symbols: str = Query(..., description="Comma-separated list of symbols, e.g., BTCUSDT,ETHUSDT"),
    interval: str = Query(..., description="Kline interval, e.g., 15, 60, 240, D"),
    category: str = Query(default="spot", description="Category: spot, linear, inverse"),
    lookback_hours: int = Query(24, ge=1, le=7*24, description="How many hours of recent data to scan per symbol (max 1 week)."),
    auto_threshold: bool = Query(True, description="Use auto threshold for FVG detection")
):
    if not bybit_http_client:
        raise HTTPException(status_code=503, detail="Bybit client not available.")

    symbol_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    if not symbol_list:
         raise HTTPException(status_code=400, detail="Symbols query parameter cannot be empty or contain only whitespace.")

    results: Dict[str, Dict[str, Any]] = {}
    end_dt_utc = datetime.now(timezone.utc)
    end_ms = int(end_dt_utc.timestamp() * 1000)
    start_ms = end_ms - (lookback_hours * 60 * 60 * 1000)

    logging.info(f"Scanning FVGs for symbols: {symbol_list}, Interval: {interval}, Lookback: {lookback_hours}h up to {end_dt_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}")

    try:
        interval_minutes = 0
        if interval.isdigit(): interval_minutes = int(interval)
        elif interval == 'D': interval_minutes = 24 * 60
        elif interval == 'W': interval_minutes = 7 * 24 * 60
        else: interval_minutes = 60 # Default for 'M' or other non-specifics
        if interval_minutes <= 0: interval_minutes = 1
        estimated_candles = (lookback_hours * 60) // interval_minutes
        limit_per_fetch = min(max(estimated_candles + 20, 50), 1000)
    except ValueError:
        limit_per_fetch = 200

    for symbol in symbol_list:
        logging.debug(f"Scanning symbol: {symbol} with limit_per_fetch={limit_per_fetch}")
        try:
            kline_df = fetch_historical_klines(
                client=bybit_http_client, category=category, symbol=symbol,
                interval=interval, start_time_ms=start_ms, end_time_ms=end_ms,
                limit_per_request=limit_per_fetch
            )
        except Exception as e:
            logging.error(f"Error fetching klines for scan ({symbol}): {e}", exc_info=True)
            results[symbol] = {"error": f"Failed to fetch kline data: {str(e)}", "fvgs": []}
            continue

        if kline_df.empty:
            results[symbol] = {"error": "No kline data found for this period.", "fvgs": [], "last_candle_timestamp": None}
            logging.warning(f"No kline data for {symbol} in scan.")
            continue

        fvgs_all = detect_fvgs(kline_df, auto_threshold=auto_threshold)

        recent_fvgs_for_symbol = []
        if fvgs_all:
            try:
                current_interval_ms = 0
                if interval.isdigit(): current_interval_ms = int(interval) * 60 * 1000
                elif interval == 'D': current_interval_ms = 24 * 60 * 60 * 1000
                else: current_interval_ms = 60 * 60 * 1000 # Default for 'W', 'M'
                if current_interval_ms <= 0 : current_interval_ms = 60 * 60 * 1000

                recent_fvg_cutoff_ms = end_ms - (3 * current_interval_ms)

                for fvg in fvgs_all:
                    fvg_timestamp_dt = fvg['timestamp']
                    if not isinstance(fvg_timestamp_dt, (datetime, pd.Timestamp)):
                        fvg_timestamp_dt = pd.to_datetime(fvg_timestamp_dt)

                    if fvg_timestamp_dt.timestamp() * 1000 >= recent_fvg_cutoff_ms:
                        fvg_copy = fvg.copy()
                        for key_dt, value_dt in fvg_copy.items():
                            if isinstance(value_dt, (datetime, pd.Timestamp)):
                                fvg_copy[key_dt] = value_dt.isoformat()
                        recent_fvgs_for_symbol.append(fvg_copy)

                logging.info(f"Found {len(recent_fvgs_for_symbol)} recent FVGs for {symbol} (out of {len(fvgs_all)} total detected in {lookback_hours}h lookback).")
            except ValueError as e:
                 logging.warning(f"Error during recent FVG filtering for {symbol} (Interval: {interval}): {e}. Returning all FVGs from lookback.", exc_info=True)
                 recent_fvgs_for_symbol = []
                 for fvg in fvgs_all:
                    fvg_copy = fvg.copy()
                    for key_dt, value_dt in fvg_copy.items():
                        if isinstance(value_dt, (datetime, pd.Timestamp)):
                            fvg_copy[key_dt] = value_dt.isoformat()
                    recent_fvgs_for_symbol.append(fvg_copy)

        last_candle_ts_iso = kline_df.iloc[-1]['timestamp'].isoformat() if not kline_df.empty and 'timestamp' in kline_df.columns and pd.notna(kline_df.iloc[-1]['timestamp']) else None
        results[symbol] = {"fvgs": recent_fvgs_for_symbol, "total_detected_in_lookback": len(fvgs_all), "last_candle_timestamp": last_candle_ts_iso}

    return results

@app.websocket("/ws/fvg-updates/{category}/{symbol}/{interval}")
async def websocket_fvg_endpoint(
    websocket: WebSocket,
    category: str,
    symbol: str,
    interval: str
):
    key = f"{category}_{symbol}_{interval}".lower()

    global_dict_management_lock = asyncio.Lock()
    async with global_dict_management_lock:
        if key not in detector_locks:
            detector_locks[key] = asyncio.Lock()

    instance_lock = detector_locks[key]

    async with instance_lock:
        if key not in detector_instances:
            if not main_event_loop:
                logging.error("Main event loop not available for RealtimeFVGDetector. Cannot start WS.")
                await websocket.accept()
                await websocket.close(code=1011, reason="Server error: Event loop not configured.")
                async with global_dict_management_lock:
                    if key in detector_locks and key not in detector_instances:
                        detector_locks.pop(key, None)
                return

            logging.info(f"First client for {key}. Creating RealtimeFVGDetector...")
            detector = RealtimeFVGDetector(category, symbol, interval, websocket_manager, main_event_loop)
            try:
                await detector.start()
                detector_instances[key] = detector
                logging.info(f"RealtimeFVGDetector for {key} started and stored.")
            except Exception as e:
                logging.error(f"Failed to start RealtimeFVGDetector for {key}: {e}", exc_info=True)
                await websocket.accept()
                await websocket.close(code=1011, reason=f"Server error: Could not start FVG detector for {key}.")
                async with global_dict_management_lock:
                    if key in detector_locks and key not in detector_instances :
                        detector_locks.pop(key, None)
                return

    await websocket_manager.connect(websocket, key)

    try:
        while True:
            data = await websocket.receive_text()
            logging.debug(f"Data received from client for {key}: {data} (not actively processed, can be used for keepalive)")
    except WebSocketDisconnect:
        logging.info(f"Client disconnected from {key} WebSocket normally.")
    except Exception as e:
        logging.error(f"Exception in WebSocket for {key}: {e}", exc_info=True)
    finally:
        websocket_manager.disconnect(websocket, key)

        async with instance_lock:
            if key not in websocket_manager.active_connections: # Check if manager confirms no connections for key
                logging.info(f"Last client for {key} disconnected (verified by ConnectionManager). Attempting to stop RealtimeFVGDetector.")
                detector_to_stop = detector_instances.pop(key, None)

                async with global_dict_management_lock:
                    lock_to_remove = detector_locks.pop(key, None)

                if detector_to_stop:
                    await detector_to_stop.stop()
                    logging.info(f"RealtimeFVGDetector for {key} stopped and removed.")
                if lock_to_remove:
                    logging.debug(f"Lock for {key} removed.")
pass
# Ensure Uvicorn is run from the project root (e.g., `fvgrab_app` directory)
# Command: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# (If main.py is in `fvgrab_app/app/main.py` and `fvgrab_app` is the root of the project/PYTHONPATH)
