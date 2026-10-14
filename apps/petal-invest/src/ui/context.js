// Mutable UI session shared by the router, screens and trade sheet.
import { createMarket } from "../domain/market.js";
import { load } from "../store.js";

export const RANGES = { "1W": 5, "1M": 21, "3M": 63, "6M": 180 };

const state = load();

export const ctx = {
  state,
  market: createMarket({ seed: state.seed }),
  range: "1M",
  filter: "",
};
