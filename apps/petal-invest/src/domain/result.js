// Tagged results for expected failures, so UI code never has to catch.
export const ok = (value) => ({ ok: true, value });
export const err = (tag, message, details = {}) => ({
  ok: false,
  error: { tag, message, ...details },
});
