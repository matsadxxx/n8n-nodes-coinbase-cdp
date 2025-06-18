import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Any
from contextlib import asynccontextmanager

import pandas as pd
import uvicorn # Keep for potential __main__ usage, though typically run via CLI
from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Assuming these modules are in the 'app' directory
# Ensure your project structure allows these imports.
# If running `python fvgrab_app/app/main.py`, `app.` prefix might be an issue
# depending on PYTHONPATH. Standard is to run from parent dir: `python -m fvgrab_app.app.main`
# or `uvicorn fvgrab_app.app.main:app`.
# For simplicity in this environment, direct imports might work if CWD is fvgrab_app/app.
# Let's assume standard project structure where `app` is a package.
from app.bybit_client import get_bybit_client, fetch_historical_klines
from app.fvg_logic import detect_fvgs
from app.backtester import run_backtest
from app.metrics import calculate_performance_metrics

# Pydantic model for backtest request (defined here or imported if in a separate models.py)
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

bybit_http_client: Optional[Any] = None # Will hold the Bybit client instance

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    global bybit_http_client
    logging.info("Application startup: Initializing Bybit client...")
    try:
        bybit_http_client = get_bybit_client() # From bybit_client.py
        if bybit_http_client is None:
            logging.error("Fatal: Failed to initialize Bybit client during startup. Endpoints needing it will fail.")
        else:
            logging.info("Bybit client initialized successfully via lifespan event.")
    except Exception as e:
        logging.error(f"Fatal: Exception during Bybit client initialization: {e}")
    yield
    logging.info("Application shutdown: Cleaning up resources (if any).")
    # Example: if bybit_http_client and hasattr(bybit_http_client, 'close'):
    #    await bybit_http_client.close() # If it's an async close

app = FastAPI(title="FVGrab API", version="0.1.0", lifespan=lifespan)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
# The path "app/static" is relative to where `uvicorn` is run.
# If run from `fvgrab_app` root, then "app/static" is correct.
# If run from `fvgrab_app/app`, then "static" would be correct.
# Assuming running from project root:
try:
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
    logging.info("Static files mounted from 'app/static'.")
except RuntimeError as e:
    # This might happen if 'app/static' doesn't exist or isn't a directory.
    # Try relative path for environments where CWD might be fvgrab_app/app
    try:
        app.mount("/static", StaticFiles(directory="static"), name="static")
        logging.info("Static files mounted from 'static'.")
    except RuntimeError as e_inner:
        logging.warning(f"Could not mount static directory from 'app/static' or 'static': {e_inner}. This is fine if no static files are served.")


def date_str_to_ms(date_str: str) -> int:
    """Converts YYYY-MM-DD string to UTC milliseconds timestamp (start of day)."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    dt_utc = dt.replace(tzinfo=timezone.utc)
    return int(dt_utc.timestamp() * 1000)

def end_date_str_to_ms(date_str: str) -> int:
    """Converts YYYY-MM-DD string to UTC milliseconds timestamp (end of day)."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    # To include the whole end_date, set time to 23:59:59.999
    dt_utc_end_of_day = datetime(dt.year, dt.month, dt.day, 23, 59, 59, 999000, tzinfo=timezone.utc)
    return int(dt_utc_end_of_day.timestamp() * 1000)


@app.get("/")
async def read_root():
    return {"message": "Welcome to FVGrab - FVG Analysis Dashboard API"}

@app.get("/api/health")
async def health_check():
    if bybit_http_client is None:
        return {"status": "unhealthy", "reason": "Bybit client not initialized"}
    try:
        # A lightweight check, e.g., fetching server time
        server_time_resp = bybit_http_client.get_server_time()
        if server_time_resp and server_time_resp.get('retCode') == 0:
            return {"status": "ok", "bybit_client_initialized": True, "bybit_server_time_utc": server_time_resp['result']['timeNano']}
        else:
            return {"status": "unhealthy", "reason": "Bybit client ping failed", "details": server_time_resp.get('retMsg')}
    except Exception as e:
        logging.error(f"Health check Bybit ping failed: {e}")
        return {"status": "unhealthy", "reason": "Bybit client ping failed", "error": str(e)}


@app.get("/api/historical-fvg", summary="Fetch historical Fair Value Gaps")
async def get_historical_fvgs_endpoint( # Renamed to avoid conflict with imported function
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
        end_ms = end_date_str_to_ms(end_date) # Use end of day for end_date
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
        logging.error(f"Error fetching klines for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch kline data from Bybit for {symbol}: {str(e)}")

    if kline_df.empty:
        logging.warning(f"No kline data found for {symbol} from {start_date} to {end_date}.")
        return []

    fvgs = detect_fvgs(kline_df, auto_threshold=auto_threshold)
    logging.info(f"Detected {len(fvgs)} FVGs for {symbol} from {start_date} to {end_date}.")
    return fvgs


@app.post("/api/backtest", summary="Run FVG Backtest")
async def run_fvg_backtest_endpoint(request: BacktestRequest): # Renamed
    if not bybit_http_client:
        raise HTTPException(status_code=503, detail="Bybit client not available.")
    try:
        start_ms = date_str_to_ms(request.start_date)
        end_ms = end_date_str_to_ms(request.end_date) # Use end of day
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
        logging.error(f"Error fetching klines for backtest ({request.symbol}): {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch kline data for backtest ({request.symbol}): {str(e)}")

    if kline_df.empty:
        raise HTTPException(status_code=404, detail=f"No kline data found for {request.symbol} from {request.start_date} to {request.end_date} to run backtest.")

    fvg_signals = detect_fvgs(kline_df, auto_threshold=request.auto_threshold_fvg)
    if not fvg_signals:
        logging.warning(f"No FVG signals detected for {request.symbol} in the period. Backtest will result in no trades.")
        # Construct a default response for no signals if desired
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

    logging.info(f"Backtest for {request.symbol} completed. Trades: {len(backtest_results['trades'])}, Final Balance: {backtest_results['final_balance']:.2f}")

    return {
        "request_params": request.dict(),
        "fvg_signals_count": len(fvg_signals),
        "trades": backtest_results['trades'], # Consider adding a note if trades are empty despite signals
        "performance_metrics": performance_metrics
    }

@app.get("/api/scan-fvgs", summary="Scan multiple symbols for recent FVGs")
async def scan_market_for_fvgs_endpoint( # Renamed
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

    results: Dict[str, List[Dict]] = {}
    end_dt_utc = datetime.now(timezone.utc)
    end_ms = int(end_dt_utc.timestamp() * 1000)
    start_ms = end_ms - (lookback_hours * 60 * 60 * 1000)

    logging.info(f"Scanning FVGs for symbols: {symbol_list}, Interval: {interval}, Lookback: {lookback_hours}h up to {end_dt_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}")

    # Estimate number of candles needed to cover lookback_hours to pass to Bybit limit
    # This is a rough guide; Bybit limit is max 1000 per request. Pagination handles more.
    try:
        interval_minutes = 0
        if interval.isdigit():
            interval_minutes = int(interval)
        elif interval == 'D':
            interval_minutes = 24 * 60
        elif interval == 'W': # Not typical for this kind of scan but handle
            interval_minutes = 7 * 24 * 60
        else: # Default for unknown intervals, or 'M'
            interval_minutes = 60 # Fallback to 1 hour if not easily parsed

        if interval_minutes == 0: interval_minutes = 1 # Avoid division by zero
        estimated_candles = (lookback_hours * 60) // interval_minutes
        limit_per_fetch = min(max(estimated_candles + 10, 50), 1000) # Ensure some buffer, cap at 1000
    except ValueError:
        limit_per_fetch = 200 # Fallback limit

    for symbol in symbol_list:
        logging.debug(f"Scanning symbol: {symbol} with limit_per_fetch={limit_per_fetch}")
        try:
            kline_df = fetch_historical_klines(
                client=bybit_http_client, category=category, symbol=symbol,
                interval=interval, start_time_ms=start_ms, end_time_ms=end_ms,
                limit_per_request=limit_per_fetch
            )
        except Exception as e:
            logging.error(f"Error fetching klines for scan ({symbol}): {e}")
            results[symbol] = {"error": f"Failed to fetch kline data: {str(e)}", "fvgs": []}
            continue

        if kline_df.empty:
            results[symbol] = {"error": "No kline data found for this period.", "fvgs": []}
            logging.warning(f"No kline data for {symbol} in scan.")
            continue

        fvgs_all = detect_fvgs(kline_df, auto_threshold=auto_threshold)

        recent_fvgs_for_symbol = []
        if fvgs_all:
            try:
                # Determine interval_ms for filtering "recent" FVGs
                # FVG timestamp is the END of the 3rd bar of the pattern.
                # We want FVGs that formed "recently", e.g. the 3rd bar is one of the last few bars.
                if interval.isdigit():
                    current_interval_ms = int(interval) * 60 * 1000
                elif interval == 'D':
                    current_interval_ms = 24 * 60 * 60 * 1000
                else: # Fallback for 'W', 'M' or other non-minute specific intervals
                    current_interval_ms = 60 * 60 * 1000 # Default to 1 hour for filtering threshold

                # Define "recent" as an FVG whose formation bar (timestamp) is within the last 3 intervals from the scan time (end_ms)
                recent_fvg_cutoff_ms = end_ms - (3 * current_interval_ms)

                for fvg in fvgs_all:
                    fvg_timestamp_dt = pd.to_datetime(fvg['timestamp']) # Already datetime from detect_fvgs
                    if fvg_timestamp_dt.timestamp() * 1000 >= recent_fvg_cutoff_ms:
                        recent_fvgs_for_symbol.append(fvg)

                logging.info(f"Found {len(recent_fvgs_for_symbol)} recent FVGs for {symbol} (out of {len(fvgs_all)} total detected in {lookback_hours}h lookback).")
            except ValueError as e:
                 logging.warning(f"Could not parse interval '{interval}' for recent FVG filtering on {symbol}: {e}. Returning all FVGs from lookback.")
                 recent_fvgs_for_symbol = fvgs_all # Fallback

        results[symbol] = {"fvgs": recent_fvgs_for_symbol, "total_detected_in_lookback": len(fvgs_all)}

    return results

# To run with uvicorn directly (though typically you'd use the uvicorn CLI command)
# if __name__ == "__main__":
#    logging.info("Starting FVGrab API with Uvicorn (main.py execution)...")
#    # Ensure CWD is 'fvgrab_app' or adjust import paths / PYTHONPATH
#    # uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
#    # For the tool environment, direct execution is not expected. Uvicorn CLI is standard.
#    # uvicorn.run(app, host="0.0.0.0", port=8000) # This would also work if 'app' object is global
pass
