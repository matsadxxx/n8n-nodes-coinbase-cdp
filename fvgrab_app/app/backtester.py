import pandas as pd
import numpy as np
import logging

# It's good practice to ensure fvg_logic is importable if running as a script
# For example, by setting PYTHONPATH or structuring as a package.
# from app.fvg_logic import detect_fvgs # Not used directly here, signals are passed in

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def run_backtest(kline_df: pd.DataFrame, fvg_signals: list,
                 initial_balance: float = 10000.0,
                 risk_per_trade_percent: float = 1.0,
                 rr_ratio_override: float = None,
                 commission_percent: float = 0.0):
    """
    Runs a backtest for FVG trading strategy.

    :param kline_df: DataFrame with historical OHLC data. Must include 'timestamp', 'open', 'high', 'low', 'close'.
    :param fvg_signals: List of FVG signal dictionaries. Expected keys: 'timestamp' (of FVG formation bar),
                        'type' ('bullish'/'bearish'), 'entry_price', 'stop_loss', 'take_profit'.
    :param initial_balance: Starting capital.
    :param risk_per_trade_percent: Max percentage of balance to risk on a single trade.
    :param rr_ratio_override: Optional float to override R:R ratio from FVG signal.
    :param commission_percent: Commission fee per trade (e.g., 0.1 for 0.1%), applied to both entry and exit.
    :return: Dictionary with 'trades' list and 'final_balance'.
    """
    if not isinstance(kline_df, pd.DataFrame) or kline_df.empty:
        logging.warning("Kline DataFrame is empty or not a DataFrame. Cannot run backtest.")
        return {"trades": [], "final_balance": initial_balance}

    required_cols = ['timestamp', 'open', 'high', 'low', 'close']
    if not all(col in kline_df.columns for col in required_cols):
        logging.error(f"Kline DataFrame must contain columns: {required_cols}")
        return {"trades": [], "final_balance": initial_balance}

    balance = initial_balance
    trades = []
    active_trade = None

    df = kline_df.sort_values(by='timestamp').reset_index(drop=True)
    signals = sorted(fvg_signals, key=lambda x: x['timestamp'])
    signal_idx = 0

    logging.info(f"Starting backtest. Initial Balance: {initial_balance:.2f}, Risk/Trade: {risk_per_trade_percent}%, Commission: {commission_percent}%.")

    for i in range(len(df)):
        current_bar = df.iloc[i]
        current_time = current_bar['timestamp']
        current_open = current_bar['open']
        current_high = current_bar['high']
        current_low = current_bar['low']
        # current_close = current_bar['close'] # Not directly used in main logic, but good to have

        # --- Manage Active Trade ---
        if active_trade:
            exit_price = None
            exit_reason = None

            # Determine if SL or TP was hit by the current bar's H/L prices
            if active_trade['type'] == 'bullish':
                if current_low <= active_trade['stop_loss']:
                    exit_price = active_trade['stop_loss']
                    exit_reason = 'SL_HIT'
                elif current_high >= active_trade['take_profit']:
                    exit_price = active_trade['take_profit']
                    exit_reason = 'TP_HIT'
            elif active_trade['type'] == 'bearish':
                if current_high >= active_trade['stop_loss']:
                    exit_price = active_trade['stop_loss']
                    exit_reason = 'SL_HIT'
                elif current_low <= active_trade['take_profit']:
                    exit_price = active_trade['take_profit']
                    exit_reason = 'TP_HIT'

            if exit_reason: # If trade was closed
                entry_price_actual = active_trade['entry_price_actual']
                position_size_coins = active_trade['position_size_coins']

                if active_trade['type'] == 'bullish':
                    pnl_before_commission = (exit_price - entry_price_actual) * position_size_coins
                else: # bearish
                    pnl_before_commission = (entry_price_actual - exit_price) * position_size_coins

                entry_value = entry_price_actual * position_size_coins
                exit_value = exit_price * position_size_coins
                commission_paid = (abs(entry_value) + abs(exit_value)) * (commission_percent / 100.0)

                pnl_absolute = pnl_before_commission - commission_paid

                prev_balance_at_entry = active_trade['balance_at_entry']
                balance += pnl_absolute

                trade_summary = {
                    **active_trade, # Contains all details from when trade was opened
                    'exit_timestamp': current_time,
                    'exit_price_actual': exit_price,
                    'exit_reason': exit_reason,
                    'pnl_absolute': pnl_absolute,
                    'pnl_percentage_of_entry_balance': (pnl_absolute / prev_balance_at_entry) * 100 if prev_balance_at_entry else 0,
                    'balance_after_trade': balance,
                    'commission_paid': commission_paid
                }
                trades.append(trade_summary)
                logging.debug(f"Trade Closed: {active_trade['type']} {active_trade.get('fvg_signal_id','N/A')} - Entry: {entry_price_actual:.2f}, Exit: {exit_price:.2f} ({exit_reason}), PnL: {pnl_absolute:.2f}, Comm: {commission_paid:.2f}, Balance: {balance:.2f}")
                active_trade = None

        # --- Check for New Trade Entry (if no active trade and still signals to process) ---
        if not active_trade and signal_idx < len(signals):
            # We are on current_bar (index i). Signal timestamp is end of formation bar.
            # Entry is on the bar *after* signal formation.
            while signal_idx < len(signals):
                signal = signals[signal_idx]

                # If signal's timestamp is from a previous bar (formation bar has closed)
                # current_time is the timestamp of the OPEN of the current bar `i`.
                # signal['timestamp'] is the timestamp of the CLOSE of the FVG formation bar.
                # So, if current_time > signal['timestamp'], current_bar is a candidate for entry.
                if current_time > signal['timestamp']:
                    entry_price_from_signal = signal['entry_price']
                    sl_from_signal = signal['stop_loss']
                    tp_from_signal = signal['take_profit']

                    # Apply R:R override if provided
                    if rr_ratio_override and rr_ratio_override > 0:
                        risk_per_unit_abs = abs(entry_price_from_signal - sl_from_signal)
                        if risk_per_unit_abs == 0: # Should not happen with valid FVGs
                             logging.warning(f"Signal {signal.get('fvg_signal_id','N/A')} has zero risk (entry=SL). Skipping.")
                             signal_idx += 1
                             continue
                        if signal['type'] == 'bullish':
                            tp_from_signal = entry_price_from_signal + rr_ratio_override * risk_per_unit_abs
                        else: # bearish
                            tp_from_signal = entry_price_from_signal - rr_ratio_override * risk_per_unit_abs

                    # Entry condition: Can we enter on this current_bar?
                    # Simplistic: enter at signal's entry_price if current_bar's open allows it
                    # and the bar doesn't immediately hit SL before entry.
                    attempt_entry_price = entry_price_from_signal # Target entry price
                    can_enter = False

                    if signal['type'] == 'bullish':
                        # Enter if current_open is around or below target, and current_low doesn't violate SL.
                        # And current bar's range [low,high] must span the entry price.
                        if current_low <= attempt_entry_price <= current_high and current_low > sl_from_signal:
                            can_enter = True
                    elif signal['type'] == 'bearish':
                        # Enter if current_open is around or above target, and current_high doesn't violate SL.
                        if current_low <= attempt_entry_price <= current_high and current_high < sl_from_signal:
                            can_enter = True

                    if can_enter:
                        risk_capital_per_trade = balance * (risk_per_trade_percent / 100.0)
                        risk_per_coin_abs = abs(attempt_entry_price - sl_from_signal)

                        if risk_per_coin_abs <= 0: # Avoid division by zero or invalid risk
                            logging.warning(f"Skipping trade for signal at {signal['timestamp']} due to zero/negative risk amount (Entry: {attempt_entry_price}, SL: {sl_from_signal}).")
                            signal_idx += 1
                            continue

                        position_size_coins = risk_capital_per_trade / risk_per_coin_abs

                        active_trade = {
                            'fvg_signal_timestamp': signal['timestamp'],
                            'fvg_signal_id': signal.get('fvg_bar_close', f"Signal@{signal['timestamp']}"), # Use a unique ID if available
                            'entry_timestamp': current_time, # Entry bar's open time
                            'entry_price_signal': entry_price_from_signal,
                            'entry_price_actual': attempt_entry_price, # Actual entry price
                            'stop_loss': sl_from_signal,
                            'take_profit': tp_from_signal,
                            'type': signal['type'],
                            'position_size_coins': position_size_coins,
                            'balance_at_entry': balance,
                            'initial_rr_ratio': abs(tp_from_signal - attempt_entry_price) / risk_per_coin_abs if risk_per_coin_abs else 0,
                            'risk_per_trade_percent_setting': risk_per_trade_percent,
                            'rr_override_setting': rr_ratio_override
                        }
                        logging.debug(f"Trade Opened: {active_trade['type']} {active_trade.get('fvg_signal_id','N/A')} at {attempt_entry_price:.2f} (SL: {sl_from_signal:.2f}, TP: {tp_from_signal:.2f}), Size: {position_size_coins:.4f}, Balance: {balance:.2f}")
                        signal_idx += 1
                        break # Exit signal loop, only one trade at a time
                    else:
                        # Cannot enter this signal on this bar (e.g., price gapped beyond entry)
                        # Consider this signal missed for this bar. If it's an old signal, it's fully missed.
                        # If signals can persist, this logic might need adjustment.
                        # For now, if a signal is for bar K, and we are on bar K+1, if we can't enter, it's missed.
                        logging.debug(f"Signal at {signal['timestamp']} for {signal['type']} {signal['entry_price']:.2f} missed on bar {current_time} (O:{current_open} H:{current_high} L:{current_low})")
                        signal_idx += 1 # Move to next signal, maybe it's also old and can be processed.

                elif signal['timestamp'] >= current_time:
                    # This signal (and subsequent ones) are for the current bar's close or future bars.
                    # Not actionable yet for entry.
                    break
                else: # Should not happen if current_time > signal['timestamp'] is the main condition
                    signal_idx += 1


        # End of kline loop
        if i == len(df) - 1 and active_trade: # If backtest ends with an open trade
             logging.info(f"Backtest ended. Active trade for {active_trade.get('fvg_signal_id','N/A')} is being marked to market using last bar's close price: {current_close:.2f}.")
             exit_price = current_close # Mark to market with the last available close price
             entry_price_actual = active_trade['entry_price_actual']
             position_size_coins = active_trade['position_size_coins']

             if active_trade['type'] == 'bullish':
                 pnl_before_commission = (exit_price - entry_price_actual) * position_size_coins
             else: # bearish
                 pnl_before_commission = (entry_price_actual - exit_price) * position_size_coins

             entry_value = entry_price_actual * position_size_coins
             exit_value = exit_price * position_size_coins
             commission_paid = (abs(entry_value) + abs(exit_value)) * (commission_percent / 100.0)
             pnl_absolute = pnl_before_commission - commission_paid

             balance += pnl_absolute
             trade_summary = {
                 **active_trade,
                 'exit_timestamp': current_time, # current_bar is the last bar
                 'exit_price_actual': exit_price,
                 'exit_reason': 'MARK_TO_MARKET_END_OF_DATA',
                 'pnl_absolute': pnl_absolute,
                 'pnl_percentage_of_entry_balance': (pnl_absolute / active_trade['balance_at_entry']) * 100 if active_trade['balance_at_entry'] else 0,
                 'balance_after_trade': balance,
                 'commission_paid': commission_paid
             }
             trades.append(trade_summary)
             active_trade = None

    logging.info(f"Backtest completed. Final Balance: {balance:.2f}. Total Trades: {len(trades)}")
    return {"trades": trades, "final_balance": balance}

if __name__ == '__main__':
    logging.getLogger().setLevel(logging.DEBUG) # Enable debug level for test
    logging.info("Testing Backtester Engine...")

    sample_kline_data = {
        'timestamp': pd.to_datetime([
            '2023-01-01 09:00', '2023-01-01 09:05',
            '2023-01-01 09:10', # Bullish FVG forms on this bar (index 2), signal timestamp is END of this bar.
            '2023-01-01 09:15', # Entry attempt for bullish FVG on this bar (index 3)
            '2023-01-01 09:20', '2023-01-01 09:25', # TP for bullish FVG (117) hit by high of bar index 5 (09:25) if R:R=2
                                                  # TP for bullish FVG (123) hit by high of bar index 5 (09:25) if R:R=3
            '2023-01-01 09:30', '2023-01-01 09:35',
            '2023-01-01 09:40', '2023-01-01 09:45',
            '2023-01-01 09:50', # Bearish FVG forms on this bar (index 10)
            '2023-01-01 09:55', # Entry attempt for bearish FVG on this bar (index 11)
            '2023-01-01 10:00', '2023-01-01 10:05', '2023-01-01 10:10' # SL for bearish FVG (107) hit by high of bar 13 (10:05)
        ]),
        # Bullish FVG: Bar0(i-2 @ 09:00) H=103, L=99. Bar1(i-1 @ 09:05) C=105. Bar2(i @ 09:10) L=107.
        # Entry=(107+103)/2=105. SL=99. TP(2:1)=105+2*(105-99)=117. TP(3:1)=105+3*6=123.
        'open':  [100, 102, 108, 104,   106,   110,   115,   116,   110, 108, 105,  101,   98,  106,  93],
        # Bar 3 (09:15) O=104. Bullish Entry at 105. Range [103,105]. Yes, enter.
        'high':  [103, 106, 110, 105,   107,   122,   118,   117,   112, 109, 106.5,102,   99,  107,  94],
        # Bar 5 (09:25) H=122. Hits TP=117 and TP=123.
        # Bar 13 (10:05) H=107. Hits SL=107 for bearish trade.
        'low':   [99,  101, 107, 103,   104,   109,   114,   115,   108, 106, 103,  100,   96,  105,  90],
        # Bar 11 (09:55) O=101. Bearish Entry at 100. Range [100,102]. Yes, enter.
        'close': [102, 105, 109, 104.5, 105,   119,   116,   116.5, 109, 107.5,104,100.5, 97,  105.5,92]
    }
    sample_kline_df = pd.DataFrame(sample_kline_data)

    sample_fvg_signals = [
        {
            'timestamp': pd.to_datetime('2023-01-01 09:10'), 'type': 'bullish',
            'entry_price': 105, 'stop_loss': 99, 'take_profit': 117,
            'fvg_bar_close': 109
        },
        {
            'timestamp': pd.to_datetime('2023-01-01 09:50'), 'type': 'bearish',
            'entry_price': 100, 'stop_loss': 107, 'take_profit': 86, # 100-2*(107-100)=86
            'fvg_bar_close': 104
        }
    ]

    def print_trade_summary(results, test_name):
        print(f"\n--- {test_name} ---")
        print(f"Final Balance: {results['final_balance']:.2f}")
        print(f"Total Trades: {len(results['trades'])}")
        for trade in results['trades']:
            print(f"  Signal @ {trade['fvg_signal_timestamp']:%H:%M} ({trade['type']}), "
                  f"Entry: {trade['entry_price_actual']:.2f} @ {trade['entry_timestamp']:%H:%M}, "
                  f"Exit: {trade['exit_price_actual']:.2f} @ {trade['exit_timestamp']:%H:%M} ({trade['exit_reason']}), "
                  f"SL: {trade['stop_loss']:.2f}, TP: {trade['take_profit']:.2f} (RR: {trade['initial_rr_ratio']:.2f}), "
                  f"PnL: {trade['pnl_absolute']:.2f} (Comm: {trade.get('commission_paid',0):.2f}), "
                  f"Balance: {trade['balance_after_trade']:.2f}")

    # Test 1: Signal R:R (approx 2:1 for these signals), No Commission
    results_signal_rr_no_comm = run_backtest(sample_kline_df.copy(), list(sample_fvg_signals), commission_percent=0.0, risk_per_trade_percent=1.0)
    # Expected Bullish: Entry 105, SL 99, TP 117. Risk 6. TP hit at 117 (bar 09:25, high 122). PnL = (117-105)*pos_size.
    #   pos_size = (10000 * 0.01) / 6 = 100 / 6 = 16.6667. PnL = 12 * 16.6667 = 200. Balance = 10200.
    # Expected Bearish: Entry 100, SL 107, TP 86. Risk 7.
    #   pos_size = (10200 * 0.01) / 7 = 102 / 7 = 14.57. SL hit at 107 (bar 10:05, high 107). PnL = (100-107)*pos_size = -7 * 14.57 = -102. Balance = 10200 - 102 = 10098.
    print_trade_summary(results_signal_rr_no_comm, "Test 1: Signal R:R, No Commission")


    # Test 2: RR Override (3:1), With Commission (0.1%)
    # Bullish TP with 3:1 RR: 105 + 3*6 = 123. Hit by bar 09:25 (high 122). No, TP is 123, high is 122. So it's not hit.
    # Let's adjust sample data for a clear TP hit for 3:1, or accept it doesn't hit.
    # sample_kline_data['high'][5] = 124 # Ensure TP at 123 is hit
    # For now, assume original data. TP 123 not hit.
    # If TP 123 not hit, and SL 99 not hit, trade remains open. Mark to market at end (92).
    # PnL = (92-105)*16.6667 = -13 * 16.6667 = -216.67.
    # Commission on entry: 105 * 16.6667 * 0.001 = 1.75. Commission on exit: 92 * 16.6667 * 0.001 = 1.53. Total=3.28
    # Total PnL = -216.67 - 3.28 = -219.95. Balance = 10000 - 219.95 = 9780.05

    # Bearish TP with 3:1 RR: 100 - 3*7 = 79.
    #   pos_size for next trade (if first lost): (9780.05 * 0.01) / 7 = 97.80 / 7 = 13.97.
    #   SL hit at 107. PnL = (100-107)*13.97 = -7 * 13.97 = -97.79.
    #   Commission: (100*13.97*0.001) + (107*13.97*0.001) = 1.397 + 1.494 = 2.89.
    #   Total PnL = -97.79 - 2.89 = -100.68. Balance = 9780.05 - 100.68 = 9679.37

    # This manual trace is complex. Let the code run.
    # The first bullish trade (TP=117) will close. The second one (TP=86) will also close.
    # Let's re-run with adjusted data for the 3:1 override for clarity.

    kline_df_for_rr_test = sample_kline_df.copy()
    kline_df_for_rr_test.loc[kline_df_for_rr_test.index[5], 'high'] = 124 # Bar @ 09:25, ensuring TP=123 for bullish is hit
    kline_df_for_rr_test.loc[kline_df_for_rr_test.index[14], 'low'] = 78 # Bar @ 10:10, ensuring TP=79 for bearish is hit


    results_override_comm = run_backtest(kline_df_for_rr_test, list(sample_fvg_signals),
                                         rr_ratio_override=3.0, commission_percent=0.1, risk_per_trade_percent=1.0)
    # Expected Bullish (3:1 RR, TP=123): Entry 105, SL 99, TP 123. Risk 6. Hit TP at 123 (bar 09:25, high 124).
    #   pos_size = (10000 * 0.01) / 6 = 16.6667. PnL before comm = (123-105)*16.6667 = 18 * 16.6667 = 300.
    #   Comm = (105*16.6667 + 123*16.6667)*0.001 = (1750+2050)*0.001 = 3.80.
    #   PnL after comm = 300 - 3.80 = 296.20. Balance = 10296.20.
    # Expected Bearish (3:1 RR, TP=79): Entry 100, SL 107, TP 79. Risk 7. Hit TP at 79 (bar 10:10, low 78).
    #   pos_size = (10296.20 * 0.01) / 7 = 102.962 / 7 = 14.708. PnL before comm = (100-79)*14.708 = 21 * 14.708 = 308.87.
    #   Comm = (100*14.708 + 79*14.708)*0.001 = (1470.8 + 1161.93)*0.001 = 2.63.
    #   PnL after comm = 308.87 - 2.63 = 306.24. Balance = 10296.20 + 306.24 = 10602.44.
    print_trade_summary(results_override_comm, "Test 2: RR Override (3:1), With Commission (0.1%) and Adjusted Kline for TP")

    # Test 3: No signals
    results_no_signals = run_backtest(sample_kline_df.copy(), [], commission_percent=0.1)
    print_trade_summary(results_no_signals, "Test 3: No Signals")

    # Test 4: Signal that never gets entered (e.g., price gaps away)
    kline_gapped_entry = sample_kline_df.copy()
    kline_gapped_entry.loc[kline_gapped_entry.index[3], 'open'] = 107 # Bullish signal entry is 105. Open is 107.
    kline_gapped_entry.loc[kline_gapped_entry.index[3], 'low'] = 106  # Low is 106, never reaches 105.

    results_gapped = run_backtest(kline_gapped_entry, list(sample_fvg_signals), commission_percent=0.0)
    print_trade_summary(results_gapped, "Test 4: Gapped Entry (Bullish Missed)")
    # Expected: Bullish trade missed. Bearish trade might still execute.
    # Bearish trade: Entry 100, SL 107, TP 86. Balance 10000. Pos size = (10000*0.01)/7 = 14.28. SL hit. PnL = -7*14.28 = -100. Bal=9900.

    # Test 5: Immediate SL hit on entry bar
    kline_immediate_sl = sample_kline_df.copy()
    # Bullish signal: entry 105, SL 99.
    # Bar for entry (index 3): Open 104, High 105, Low 98
    kline_immediate_sl.loc[kline_immediate_sl.index[3], 'open'] = 104
    kline_immediate_sl.loc[kline_immediate_sl.index[3], 'high'] = 105 # Allows entry at 105
    kline_immediate_sl.loc[kline_immediate_sl.index[3], 'low'] = 98   # SL is 99, so this bar hits SL.
    # The current logic: if current_low <= SL, it's an SL. This is checked *after* entry.
    # The entry condition `current_low > stop_loss_signal` for bullish should prevent this. Let's test it.
    # `current_low (98) > sl_from_signal (99)` is FALSE. So entry should NOT happen.

    results_imm_sl = run_backtest(kline_immediate_sl, list(sample_fvg_signals), commission_percent=0.0)
    print_trade_summary(results_imm_sl, "Test 5: Immediate SL on Entry Bar (Bullish Entry should be skipped)")
    # Expected: Bullish trade skipped. Bearish trade as in Test 4 (PnL -100, Bal 9900).
