// Price chart: candles, volume, overlays and an RSI pane on one
// Lightweight Charts instance.
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
} from "./vendor.js";
import { sma, ema, bollinger, rsi } from "../domain/indicators.js";

const UP = "#26a69a";

// Some environments report locales such as "en-US@posix" that Intl rejects.
function safeLocale() {
  try {
    return Intl.getCanonicalLocales(navigator.language)[0];
  } catch {
    return "en-US";
  }
}
const DOWN = "#ef5350";

function addOverlays(chart) {
  const line = (color, width = 1.5, style) =>
    chart.addSeries(LineSeries, {
      color,
      lineWidth: width,
      lineStyle: style,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
  return {
    sma: line("#f7a21b"),
    ema: line("#2962ff"),
    bbUpper: line("#9c27b0", 1, LineStyle.Dashed),
    bbMiddle: line("#9c27b0", 1),
    bbLower: line("#9c27b0", 1, LineStyle.Dashed),
  };
}

// RSI lives in its own pane, created and removed as it is toggled.
function createRsiPane(chart) {
  let series;
  function show() {
    series = chart.addSeries(
      LineSeries,
      { color: "#7e57c2", lineWidth: 1.5, priceLineVisible: false },
      1,
    );
    for (const price of [70, 30]) {
      series.createPriceLine({
        price,
        color: "#787b86",
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      });
    }
    chart.panes()[1]?.setHeight(110);
  }
  function hide() {
    chart.removeSeries(series);
    series = undefined;
    if (chart.panes().length > 1) chart.removePane(1);
  }
  return {
    set(data) {
      if (data && !series) show();
      if (!data && series) hide();
      series?.setData(data ?? []);
    },
  };
}

function baseChart(container) {
  return createChart(container, {
    autoSize: true,
    layout: {
      background: { color: "#131722" },
      textColor: "#b2b5be",
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      panes: { separatorColor: "#2a2e39" },
    },
    grid: {
      vertLines: { color: "#1e222d" },
      horzLines: { color: "#1e222d" },
    },
    localization: { locale: safeLocale() },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: "#2a2e39" },
    timeScale: {
      borderColor: "#2a2e39",
      timeVisible: true,
      secondsVisible: false,
    },
  });
}

export function createPriceChart(container, { onCrosshair }) {
  const chart = baseChart(container);

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: UP,
    downColor: DOWN,
    borderVisible: false,
    wickUpColor: UP,
    wickDownColor: DOWN,
  });
  const markers = createSeriesMarkers(candles, []);
  const overlays = addOverlays(chart);
  const rsiPane = createRsiPane(chart);
  const volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    lastValueVisible: false,
    priceLineVisible: false,
  });
  chart
    .priceScale("volume")
    .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  let shown = {};
  let lastBars = [];
  let hovering = false;

  const volBar = (b) => ({
    time: b.time,
    value: b.volume,
    color: b.close >= b.open ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)",
  });

  function drawIndicators(bars) {
    overlays.sma.setData(shown.sma ? sma(bars, 20) : []);
    overlays.ema.setData(shown.ema ? ema(bars, 50) : []);
    const bb = shown.bb
      ? bollinger(bars, 20, 2)
      : { upper: [], middle: [], lower: [] };
    overlays.bbUpper.setData(bb.upper);
    overlays.bbMiddle.setData(bb.middle);
    overlays.bbLower.setData(bb.lower);
    rsiPane.set(shown.rsi ? rsi(bars, 14) : undefined);
  }

  chart.subscribeCrosshairMove((param) => {
    const bar = param.time ? param.seriesData.get(candles) : undefined;
    hovering = Boolean(bar);
    onCrosshair(bar ?? lastBars.at(-1));
  });

  return {
    setIndicators(next) {
      shown = { ...next };
      volume.applyOptions({ visible: Boolean(shown.volume) });
      drawIndicators(lastBars);
    },
    setBars(bars, { precision }) {
      lastBars = bars;
      candles.applyOptions({
        priceFormat: { type: "price", precision, minMove: 10 ** -precision },
      });
      candles.setData(bars);
      volume.setData(bars.map(volBar));
      drawIndicators(bars);
      chart.timeScale().scrollToRealTime();
      onCrosshair(bars.at(-1));
    },
    // Live update of the newest bar. Indicators are recomputed from the
    // shared bars array, which is small enough (≤ ~500 bars) to redo.
    updateBar(bar, bars) {
      lastBars = bars;
      candles.update(bar);
      volume.update(volBar(bar));
      drawIndicators(bars);
      if (!hovering) onCrosshair(bar);
    },
    setFills(fills) {
      markers.setMarkers(
        fills.map((o) => ({
          time: o.barTime,
          position: o.side === "buy" ? "belowBar" : "aboveBar",
          color: o.side === "buy" ? UP : DOWN,
          shape: o.side === "buy" ? "arrowUp" : "arrowDown",
          text: `${o.side === "buy" ? "B" : "S"} ${o.qty}`,
        })),
      );
    },
    remove: () => chart.remove(),
  };
}
