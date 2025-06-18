import pandas as pd
import numpy as np
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def calculate_performance_metrics(trades: list, initial_balance: float,
                                  risk_free_rate_annual: float = 0.0):
    """
    Calculates various performance metrics from a list of trades.

    :param trades: List of trade dictionaries. Expected keys:
                   'pnl_absolute', 'entry_timestamp', 'exit_timestamp',
                   'balance_at_entry', 'balance_after_trade'.
    :param initial_balance: The starting balance of the backtest.
    :param risk_free_rate_annual: Annual risk-free rate (e.g., 0.02 for 2%).
    :return: Dictionary containing performance metrics.
    """
    if not trades:
        logging.warning("No trades provided. Cannot calculate metrics.")
        return {
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "neutral_trades": 0,
            "win_rate_percent": 0.0,
            "profit_factor": 0.0,
            "sharpe_ratio_annualized": 0.0,
            "max_drawdown_percent": 0.0,
            "avg_holding_time_hours": 0.0,
            "avg_profit_per_trade": 0.0,
            "avg_winning_trade": 0.0,
            "avg_losing_trade": 0.0,
            "total_pnl_absolute": 0.0,
            "initial_balance": initial_balance,
            "final_balance": initial_balance,
            "gross_profit": 0.0,
            "gross_loss": 0.0,
            "message": "No trades to analyze."
        }

    trade_df = pd.DataFrame(trades)

    # Ensure timestamps are datetime objects
    trade_df['entry_timestamp'] = pd.to_datetime(trade_df['entry_timestamp'])
    trade_df['exit_timestamp'] = pd.to_datetime(trade_df['exit_timestamp'])

    total_trades = len(trade_df)
    final_balance = trade_df['balance_after_trade'].iloc[-1] if total_trades > 0 else initial_balance
    total_pnl = final_balance - initial_balance

    # Win Rate
    winning_trades_df = trade_df[trade_df['pnl_absolute'] > 0]
    losing_trades_df = trade_df[trade_df['pnl_absolute'] < 0]
    neutral_trades_df = trade_df[trade_df['pnl_absolute'] == 0]
    win_rate_percent = (len(winning_trades_df) / total_trades) * 100 if total_trades > 0 else 0.0

    # Profit Factor
    gross_profit = winning_trades_df['pnl_absolute'].sum()
    gross_loss = abs(losing_trades_df['pnl_absolute'].sum())
    if gross_loss == 0:
        profit_factor = np.inf if gross_profit > 0 else 0.0
    else:
        profit_factor = gross_profit / gross_loss

    # Average Holding Time
    trade_df['duration_seconds'] = (trade_df['exit_timestamp'] - trade_df['entry_timestamp']).dt.total_seconds()
    avg_holding_time_seconds = trade_df['duration_seconds'].mean() if total_trades > 0 else 0.0
    avg_holding_time_hours = avg_holding_time_seconds / 3600.0

    # Average Profit/Loss
    avg_profit_per_trade = trade_df['pnl_absolute'].mean() if total_trades > 0 else 0.0
    avg_winning_trade = winning_trades_df['pnl_absolute'].mean() if not winning_trades_df.empty else 0.0
    avg_losing_trade = losing_trades_df['pnl_absolute'].mean() if not losing_trades_df.empty else 0.0

    # Maximum Drawdown
    account_curve = pd.Series([initial_balance] + list(trade_df['balance_after_trade']))
    peak_curve = account_curve.expanding(min_periods=1).max()
    drawdown_curve = (account_curve - peak_curve) / peak_curve
    # Ensure peak_curve is not zero to avoid division by zero if balance goes to 0 then recovers.
    # drawdown_curve = (account_curve - peak_curve).divide(peak_curve.replace(0, np.nan), fill_value=0) # More robust
    max_drawdown_percent = abs(drawdown_curve.min()) * 100 if not drawdown_curve.empty and pd.notna(drawdown_curve.min()) else 0.0

    # Sharpe Ratio (Annualized)
    # Calculate per-trade returns based on balance at entry
    trade_df['return_pct_on_entry_balance'] = trade_df['pnl_absolute'] / trade_df['balance_at_entry']

    sharpe_ratio_annualized = 0.0 # Default
    if total_trades > 1 : # Need at least 2 trades for standard deviation
        std_dev_trade_return = trade_df['return_pct_on_entry_balance'].std()
        if pd.notna(std_dev_trade_return) and std_dev_trade_return != 0:
            avg_trade_return = trade_df['return_pct_on_entry_balance'].mean()

            first_trade_start = trade_df['entry_timestamp'].min()
            last_trade_end = trade_df['exit_timestamp'].max()
            total_duration_seconds = (last_trade_end - first_trade_start).total_seconds()

            # Ensure total_duration_days is at least 1 to avoid issues with very short backtests
            total_duration_days = max(total_duration_seconds / (24 * 60 * 60), 1.0)

            # Estimate trades per year, using 252 as standard trading days in a year
            trades_per_year_estimate = (total_trades / total_duration_days) * 252.0

            # If trades_per_year_estimate is very low (e.g. <1 from a short test), Sharpe might not be meaningful.
            # Cap trades_per_year_estimate or handle if it's zero.
            if trades_per_year_estimate <= 0: trades_per_year_estimate = 1 # Avoid sqrt(0) or negative

            annualized_mean_return = avg_trade_return * trades_per_year_estimate
            annualized_std_dev = std_dev_trade_return * np.sqrt(trades_per_year_estimate)

            if annualized_std_dev > 0:
                sharpe_ratio_annualized = (annualized_mean_return - risk_free_rate_annual) / annualized_std_dev
            # else: sharpe_ratio_annualized remains 0.0 (e.g. if all returns were identical, std_dev is 0)
        # else: sharpe_ratio_annualized remains 0.0 (std_dev is 0 or NaN)
    # else: sharpe_ratio_annualized remains 0.0 (not enough trades)


    return {
        "total_trades": total_trades,
        "winning_trades": len(winning_trades_df),
        "losing_trades": len(losing_trades_df),
        "neutral_trades": len(neutral_trades_df),
        "win_rate_percent": win_rate_percent,
        "profit_factor": profit_factor,
        "sharpe_ratio_annualized": sharpe_ratio_annualized,
        "max_drawdown_percent": max_drawdown_percent,
        "avg_holding_time_hours": avg_holding_time_hours,
        "avg_profit_per_trade": avg_profit_per_trade,
        "avg_winning_trade": avg_winning_trade,
        "avg_losing_trade": avg_losing_trade,
        "total_pnl_absolute": total_pnl,
        "initial_balance": initial_balance,
        "final_balance": final_balance,
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "message": "Metrics calculated successfully."
    }

if __name__ == '__main__':
    logging.getLogger().setLevel(logging.DEBUG)
    logging.info("Testing Performance Metrics Calculation...")

    # Timestamps spread over a few days to test annualization
    sample_trades_data = [
        {'pnl_absolute': 100, 'entry_timestamp': pd.to_datetime('2023-01-01 10:00'), 'exit_timestamp': pd.to_datetime('2023-01-01 12:00'), 'balance_at_entry': 10000, 'balance_after_trade': 10100},
        {'pnl_absolute': -50, 'entry_timestamp': pd.to_datetime('2023-01-01 13:00'), 'exit_timestamp': pd.to_datetime('2023-01-01 14:00'), 'balance_at_entry': 10100, 'balance_after_trade': 10050},
        {'pnl_absolute': 200, 'entry_timestamp': pd.to_datetime('2023-01-02 09:00'), 'exit_timestamp': pd.to_datetime('2023-01-02 15:00'), 'balance_at_entry': 10050, 'balance_after_trade': 10250},
        {'pnl_absolute': -20, 'entry_timestamp': pd.to_datetime('2023-01-03 10:00'), 'exit_timestamp': pd.to_datetime('2023-01-03 11:00'), 'balance_at_entry': 10250, 'balance_after_trade': 10230},
        {'pnl_absolute': 150, 'entry_timestamp': pd.to_datetime('2023-01-03 12:00'), 'exit_timestamp': pd.to_datetime('2023-01-03 18:00'), 'balance_at_entry': 10230, 'balance_after_trade': 10380},
    ]

    initial_bal = 10000.0

    def print_metrics(metrics_dict, test_name="Calculated Metrics"):
        print(f"\n--- {test_name} ---")
        for key, value in metrics_dict.items():
            if isinstance(value, float):
                print(f"  {key}: {value:.4f}")
            else:
                print(f"  {key}: {value}")

    metrics = calculate_performance_metrics(list(sample_trades_data), initial_bal, risk_free_rate_annual=0.02)
    print_metrics(metrics, "Test 1: Sample Trades (RFR=2%)")

    metrics_no_rfr = calculate_performance_metrics(list(sample_trades_data), initial_bal, risk_free_rate_annual=0.0)
    print_metrics(metrics_no_rfr, "Test 2: Sample Trades (RFR=0%)")

    no_trades_metrics = calculate_performance_metrics([], initial_bal)
    print_metrics(no_trades_metrics, "Test 3: No Trades")

    one_trade_metrics = calculate_performance_metrics([sample_trades_data[0]], initial_bal)
    # Expected: Sharpe should be 0 or NaN as total_trades <= 1
    print_metrics(one_trade_metrics, "Test 4: One Winning Trade")

    all_wins_identical_return_on_entry_balance = [ # pnl/balance_at_entry is same for both
        {'pnl_absolute': 100, 'entry_timestamp': pd.to_datetime('2023-01-01 10:00'), 'exit_timestamp': pd.to_datetime('2023-01-01 12:00'), 'balance_at_entry': 10000, 'balance_after_trade': 10100}, # Return = 1%
        {'pnl_absolute': 101, 'entry_timestamp': pd.to_datetime('2023-01-01 13:00'), 'exit_timestamp': pd.to_datetime('2023-01-01 14:00'), 'balance_at_entry': 10100, 'balance_after_trade': 10201}, # Return = 1%
    ]
    all_wins_metrics = calculate_performance_metrics(all_wins_identical_return_on_entry_balance, initial_bal)
    # Expected: Sharpe should be 0 or NaN as std_dev_trade_return will be 0
    print_metrics(all_wins_metrics, "Test 5: All Winning Trades with Identical Returns (StdDev=0)")

    all_losses_varied_returns = [
        {'pnl_absolute': -100, 'entry_timestamp': pd.to_datetime('2023-01-01 10:00'), 'exit_timestamp': pd.to_datetime('2023-01-01 12:00'), 'balance_at_entry': 10000, 'balance_after_trade': 9900},
        {'pnl_absolute': -50,  'entry_timestamp': pd.to_datetime('2023-01-01 13:00'), 'exit_timestamp': pd.to_datetime('2023-01-01 14:00'), 'balance_at_entry': 9900,  'balance_after_trade': 9850},
    ]
    all_losses_metrics = calculate_performance_metrics(all_losses_varied_returns, initial_bal)
    print_metrics(all_losses_metrics, "Test 6: All Losing Trades with Varied Returns")

    # Test with trades spanning less than a day to check trades_per_year_estimate logic
    short_duration_trades = [
        {'pnl_absolute': 10, 'entry_timestamp': pd.to_datetime('2023-01-01 10:00'), 'exit_timestamp': pd.to_datetime('2023-01-01 10:30'), 'balance_at_entry': 1000, 'balance_after_trade': 1010},
        {'pnl_absolute': -5, 'entry_timestamp': pd.to_datetime('2023-01-01 10:35'), 'exit_timestamp': pd.to_datetime('2023-01-01 10:50'), 'balance_at_entry': 1010, 'balance_after_trade': 1005},
    ]
    short_duration_metrics = calculate_performance_metrics(short_duration_trades, 1000.0)
    print_metrics(short_duration_metrics, "Test 7: Trades Spanning Less Than 1 Day")
    # total_duration_days will be max(actual_duration, 1.0), so trades_per_year will be (2/1)*252 = 504.
    # This is a known characteristic of this annualization method for short periods.
