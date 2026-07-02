"""데이터 로더.

1) data/ 폴더의 CSV를 우선 로드 (사용자 보유 나스닥/골드 CSV 등).
   - 필요한 컬럼: Date, Open, High, Low, Close (Volume 선택). 대소문자/한글 컬럼 자동 인식.
2) 외부 API 차단 환경 대비: PyPI 패키지에 번들된 실제 시세를 함께 로드.
   GOOG   일봉 2004-2013   (backtesting.py 번들)
   EURUSD 1시간봉 2017-2018 (backtesting.py 번들)
   MSFT   일봉 1986-2017   (pmdarima 번들)
   SP500  일봉 1999-2018   (arch 번들)
   NASDAQ 일봉 1999-2018   (arch 번들)
"""
import glob
import os
import warnings

import pandas as pd

warnings.filterwarnings("ignore")

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

COL_ALIASES = {
    "open": "Open", "시가": "Open",
    "high": "High", "고가": "High",
    "low": "Low", "저가": "Low",
    "close": "Close", "종가": "Close", "adj close": "Close", "price": "Close",
    "volume": "Volume", "거래량": "Volume", "vol": "Volume",
    "date": "Date", "날짜": "Date", "time": "Date", "datetime": "Date", "일자": "Date",
}


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if "Volume" not in df.columns:
        df["Volume"] = 0.0
    df = df[["Open", "High", "Low", "Close", "Volume"]].astype(float).dropna()
    df = df[(df["Low"] > 0) & (df["High"] >= df["Low"])]
    return df.sort_index()


def _load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [COL_ALIASES.get(str(c).strip().lower(), str(c).strip()) for c in df.columns]
    if "Date" not in df.columns:
        df = df.rename(columns={df.columns[0]: "Date"})
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date")
    # 천단위 콤마 등 문자열 숫자 처리
    for c in ["Open", "High", "Low", "Close", "Volume"]:
        if c in df.columns and df[c].dtype == object:
            df[c] = pd.to_numeric(df[c].astype(str).str.replace(",", ""), errors="coerce")
    return _clean(df)


def _load_bundled() -> dict:
    data = {}
    from backtesting.test import GOOG, EURUSD
    data["GOOG"] = _clean(GOOG.copy())
    data["EURUSD"] = _clean(EURUSD.copy())

    from pmdarima.datasets import load_msft
    msft = load_msft()
    msft["Date"] = pd.to_datetime(msft["Date"])
    msft = msft.set_index("Date")
    # 초기 저가 구간(주가 < $1)은 호가 단위 왜곡이 커서 제외
    data["MSFT"] = _clean(msft[msft["Close"] >= 1.0])

    import arch.data.nasdaq
    import arch.data.sp500
    data["SP500"] = _clean(arch.data.sp500.load())
    data["NASDAQ"] = _clean(arch.data.nasdaq.load())
    return data


def load_all(include_bundled: bool = True) -> dict:
    data = {}
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "*.csv"))):
        name = os.path.splitext(os.path.basename(path))[0].upper()
        try:
            df = _load_csv(path)
            if len(df) >= 300:
                data[name] = df
            else:
                print(f"skip {name}: {len(df)} bars (<300)")
        except Exception as e:
            print(f"skip {name}: {e}")
    if include_bundled:
        for k, v in _load_bundled().items():
            data.setdefault(k, v)
    return data


if __name__ == "__main__":
    for name, df in load_all().items():
        print(f"{name:8s} {len(df):6d} bars  {df.index[0]} ~ {df.index[-1]}")
