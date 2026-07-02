"""기본 지표 — RSI(Wilder), ATR, 볼린저밴드, MACD."""
import numpy as np
import pandas as pd


def rsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    delta = np.diff(close, prepend=close[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    ag = pd.Series(gain).ewm(alpha=1 / period, adjust=False).mean().to_numpy()
    al = pd.Series(loss).ewm(alpha=1 / period, adjust=False).mean().to_numpy()
    rs = np.divide(ag, al, out=np.full_like(ag, np.inf), where=al != 0)
    return 100 - 100 / (1 + rs)


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    return pd.Series(tr).ewm(alpha=1 / period, adjust=False).mean().to_numpy()


def bollinger(close: np.ndarray, period: int = 20, num_std: float = 2.0):
    s = pd.Series(close)
    mid = s.rolling(period).mean().to_numpy()
    std = s.rolling(period).std(ddof=0).to_numpy()
    return mid, mid + num_std * std, mid - num_std * std


def macd(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    s = pd.Series(close)
    line = (s.ewm(span=fast, adjust=False).mean() - s.ewm(span=slow, adjust=False).mean())
    sig = line.ewm(span=signal, adjust=False).mean()
    hist = line - sig
    return line.to_numpy(), sig.to_numpy(), hist.to_numpy()
