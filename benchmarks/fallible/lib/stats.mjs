// Small statistics helpers (no dependencies).

export function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(xs) {
  return quantile(
    [...xs].sort((a, b) => a - b),
    0.5
  );
}

/** n, min, p25, median, p75, p90, max, mad (median absolute deviation), iqrRel. */
export function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const med = quantile(s, 0.5);
  const dev = s.map(x => Math.abs(x - med)).sort((a, b) => a - b);
  const p25 = quantile(s, 0.25);
  const p75 = quantile(s, 0.75);
  return {
    n: s.length,
    min: s[0],
    p25,
    median: med,
    p75,
    p90: quantile(s, 0.9),
    max: s[s.length - 1],
    mad: quantile(dev, 0.5),
    iqrRel: (p75 - p25) / med,
  };
}

/** Least-squares slope of log(y) against log(x): the growth exponent. */
export function slope(points) {
  const pts = points.filter(([x, y]) => x > 0 && y > 0);
  if (pts.length < 2) return NaN;
  const lx = pts.map(([x]) => Math.log(x));
  const ly = pts.map(([, y]) => Math.log(y));
  const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
  const my = ly.reduce((a, b) => a + b, 0) / ly.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < lx.length; i++) {
    num += (lx[i] - mx) * (ly[i] - my);
    den += (lx[i] - mx) ** 2;
  }
  return num / den;
}

/** Relative range of per-process medians: (max - min) / median. */
export function relSpread(values) {
  const m = median(values);
  return (Math.max(...values) - Math.min(...values)) / m;
}
