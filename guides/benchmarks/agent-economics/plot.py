"""Regenerate README figures from recorded measurements; does not run inference."""

import json
import statistics
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[2] / ".github" / "readme"
COLORS = {"lloyal": "#FF5A36", "langgraph": "#4361EE"}
ATTENTION = "peakAttentionAllocatedBytes"
RECURRENT = "peakRecurrentAllocatedBytes"
VRAM = "peakOwnedGpuProcessBytes"


def series(rows, backend, metric):
    selected = [r for r in rows if r["backend"] == backend]
    return [
        (n, [r[metric] / 2**30 for r in selected if r["count"] == n])
        for n in sorted({r["count"] for r in selected})
    ]


def draw(ax, points, label, color, marker, linestyle="-", zorder=3):
    xs = [n for n, _ in points]
    medians = [statistics.median(v) for _, v in points]
    errors = [
        [median - min(v) for median, (_, v) in zip(medians, points)],
        [max(v) - median for median, (_, v) in zip(medians, points)],
    ]
    ax.errorbar(
        xs, medians, yerr=errors, label=label, color=color, marker=marker,
        linestyle=linestyle, linewidth=2.3, markersize=4.5, capsize=3,
        zorder=zorder,
    )


def axes(ylabel, top):
    fig, ax = plt.subplots(figsize=(4.8, 4.8))
    fig.subplots_adjust(left=.20, right=.97, bottom=.16, top=top)
    ax.set_xlabel("Requested concurrent agents")
    ax.set_ylabel(ylabel)
    ax.yaxis.set_label_coords(-.14, .5)
    ax.set_xlim(0, 264)
    ax.set_xticks([8, 64, 128, 192, 254])
    ax.grid(axis="y", alpha=.18)
    return fig, ax


def verify(rows, receipts):
    # These figures intentionally show the all-correct short-ledger condition.
    assert all(r["capacityPass"] for r in rows)
    assert all(r["validResults"] == r["expectedResults"] == 2 * r["count"] for r in rows)
    assert all(r["realizedActive"] >= r["count"] for r in rows)
    assert all(r[RECURRENT] == r["sequences"] * 50.25 * 2**20 for r in rows)
    pair = {}
    for backend in COLORS:
        matched = [r for r in rows if r["backend"] == backend and r["count"] == 128]
        assert len(matched) == 1
        pair[backend] = matched[0]
    assert len(receipts["rows"]) == 1
    for round_ in receipts["rows"][0]["rounds"]:
        assert round_["completeReceipts"] and round_["responses"] == 128
        assert round_["inputTokensWithReceipts"] == 1128832
    assert receipts["rows"][0]["rounds"][1]["cachedTokensWithReceipts"] == 1125760
    for metric, expected in [(ATTENTION, "96.3"), (VRAM, "56.6")]:
        reduction = 100 * (1 - pair["lloyal"][metric] / pair["langgraph"][metric])
        assert f"{reduction:.1f}" == expected
        print(f"{metric}: {reduction:.4f}% lower at 128 agents")


def main():
    data = json.loads((HERE / "measurements.json").read_text())
    rows = [
        r for r in data["rows"]
        if r["records"] == 256 and r["phase"] != "calibration" and r["allocationFit"]
    ]
    verify(rows, data["matched128PrefixCacheReceipts"])
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 10,
        "axes.spines.top": False, "axes.spines.right": False, "savefig.dpi": 220,
    })
    OUT.mkdir(parents=True, exist_ok=True)

    fig, ax = axes("Engine allocation (GiB)", top=.82)
    for backend, metric, label, color, marker, linestyle in [
        ("lloyal", ATTENTION, "Lloyal · attention", COLORS["lloyal"], "o", "-"),
        ("lloyal", RECURRENT, "Lloyal · recurrent", "#404752", "o", (0, (5, 3))),
        ("langgraph", ATTENTION, "HTTP · attention", COLORS["langgraph"], "s", "-"),
        ("langgraph", RECURRENT, "HTTP · recurrent", "#9AA1AC", "s", (0, (2, 3))),
    ]:
        draw(ax, series(rows, backend, metric), label, color, marker, linestyle,
             zorder=4 if metric == ATTENTION else 2)
    ax.set_ylim(bottom=0)
    ax.legend(frameon=False, fontsize=8, ncols=2, columnspacing=1.2,
              handlelength=2.4, loc="lower left", bbox_to_anchor=(-.03, 1.025))
    fig.savefig(OUT / "agent-economics-components.png")
    plt.close(fig)

    fig, ax = axes("Peak model / worker VRAM (GiB)", top=.96)
    for backend, label, marker in [
        ("langgraph", "LangGraph + HTTP (prefix-cache enabled)", "s"),
        ("lloyal", "Lloyal", "o"),
    ]:
        draw(ax, series(rows, backend, VRAM), label, COLORS[backend], marker)
    ax.set_ylim(bottom=0)
    ax.legend(frameon=False, fontsize=8, loc="best")
    fig.savefig(OUT / "agent-economics-vram.png")
    plt.close(fig)
    print(f"Wrote both figures to {OUT}")


if __name__ == "__main__":
    main()
