"""전체 경우의수 그리드서치.

그리드 (336 조합):
- rsi_period: 9, 14
- pivot_k(스윙 감도): 3, 5
- direction: long, short
- 자리 필터 조합: {sr, fib, bb}의 공집합 제외 부분집합 7개 (선택된 필터는 모두 충족해야 함)
- trigger: candle, macd, either
- target_r(손익비): 1.5, 2.5

랭킹: 총 트레이드 30건 이상 & 2개 이상 인스트루먼트에서 발생한 조합만.
score = avg_R * sqrt(n)  (기대값의 통계적 유의성 가중)
"""
import itertools
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backtest import metrics, simulate
from data_loader import load_all
from signals import build_context

RSI_PERIODS = [9, 14]
PIVOT_KS = [3, 5]
DIRECTIONS = ["long", "short"]
LOC_SUBSETS = [("sr",), ("fib",), ("bb",), ("sr", "fib"), ("sr", "bb"), ("fib", "bb"), ("sr", "fib", "bb")]
TRIGGERS = ["candle", "macd", "either"]
TARGET_RS = [1.5, 2.5]

MIN_TRADES = 30
MIN_INSTRUMENTS = 2

RESULTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")


def main():
    data = load_all()
    print(f"instruments: {list(data)}")

    print("precomputing contexts ...")
    ctxs = {}
    for name, df in data.items():
        for rp, k in itertools.product(RSI_PERIODS, PIVOT_KS):
            ctxs[(name, rp, k)] = build_context(df, rp, k)
    print(f"  {len(ctxs)} contexts done")

    rows = []
    combos = list(itertools.product(RSI_PERIODS, PIVOT_KS, DIRECTIONS, LOC_SUBSETS, TRIGGERS, TARGET_RS))
    print(f"running {len(combos)} combos x {len(data)} instruments ...")
    for idx, (rp, k, direction, locs, trigger, tr) in enumerate(combos):
        all_rs = []
        per_inst = {}
        for name in data:
            rs = simulate(ctxs[(name, rp, k)], direction, locs, trigger, tr)
            all_rs.extend(rs)
            if rs:
                per_inst[name] = metrics(rs)
        m = metrics(all_rs)
        n_inst = len(per_inst)
        n_inst_pos = sum(1 for v in per_inst.values() if v["avg_r"] > 0)
        score = m["avg_r"] * np.sqrt(m["n"]) if m["n"] > 0 else np.nan
        rows.append({
            "rsi": rp, "pivot_k": k, "direction": direction,
            "locations": "+".join(locs), "trigger": trigger, "target_r": tr,
            "n_trades": m["n"], "winrate": m["winrate"], "avg_r": m["avg_r"],
            "profit_factor": m["pf"], "total_r": m["total_r"], "max_dd_r": m["max_dd_r"],
            "n_instruments": n_inst, "n_instruments_positive": n_inst_pos,
            "score": score,
            "per_instrument": "; ".join(
                f"{k2}:n={v['n']},avgR={v['avg_r']:.2f}" for k2, v in per_inst.items()),
        })
        if (idx + 1) % 50 == 0:
            print(f"  {idx + 1}/{len(combos)}")

    res = pd.DataFrame(rows).sort_values("score", ascending=False)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    res.to_csv(os.path.join(RESULTS_DIR, "grid_results.csv"), index=False)

    ok = res[(res.n_trades >= MIN_TRADES) & (res.n_instruments >= MIN_INSTRUMENTS)]
    top10 = ok.head(10)

    lines = ["# 다이버전스 복합전략 그리드서치 — 최적 조합 TOP 10", ""]
    lines.append(f"- 전체 조합: {len(combos)}개, 유효(트레이드 {MIN_TRADES}건 이상 & {MIN_INSTRUMENTS}개 이상 인스트루먼트): {len(ok)}개")
    lines.append(f"- 데이터: " + ", ".join(f"{n}({len(d)}봉)" for n, d in data.items()))
    lines.append("- score = 평균R × √트레이드수")
    lines.append("")
    lines.append("| # | 방향 | 자리 필터 | 트리거 | 손익비 | RSI | 스윙k | 트레이드 | 승률 | 평균R | PF | 총R | MDD(R) | score |")
    lines.append("|---|------|-----------|--------|--------|-----|-------|----------|------|-------|-----|-----|--------|-------|")
    for rank, (_, r) in enumerate(top10.iterrows(), 1):
        lines.append(
            f"| {rank} | {r.direction} | {r.locations} | {r.trigger} | {r.target_r} | {r.rsi} | {r.pivot_k} "
            f"| {r.n_trades} | {r.winrate:.1%} | {r.avg_r:+.3f} | {r.profit_factor:.2f} "
            f"| {r.total_r:+.1f} | {r.max_dd_r:.1f} | {r.score:.2f} |")
    lines.append("")
    lines.append("## 인스트루먼트별 상세 (TOP 10)")
    for rank, (_, r) in enumerate(top10.iterrows(), 1):
        lines.append(f"{rank}. `{r.direction}/{r.locations}/{r.trigger}/R{r.target_r}/rsi{r.rsi}/k{r.pivot_k}` — {r.per_instrument}")
    with open(os.path.join(RESULTS_DIR, "top10.md"), "w") as f:
        f.write("\n".join(lines) + "\n")

    print("\n" + "\n".join(lines[:20]))
    print(f"\nsaved: results/grid_results.csv, results/top10.md")


if __name__ == "__main__":
    main()
