export const usd = (n, digits = 2) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const signedUsd = (n) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;

export const pct = (n) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(2)}%`;

export const shares = (n) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export const tone = (n) => (n >= 0 ? "up" : "down");

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
