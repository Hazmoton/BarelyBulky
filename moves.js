// YOUR MODULE: everything that moves cards between bins lives here, so you can rewrite it freely.
// store shape:
//   { bins:  { [binId]: { id, name, type: 'storage' | 'deck', icon } },
//     cards: { [key]: { key, name, bins: { [binId]: quantity }, ...scryfall fields } } }
// `key` is the card's name ("any printing") or "name|set|collector number" when a printing was chosen,
// so one card name can have several records. It changes `store` in place and returns true if anything moved.
// It does NOT save or redraw: the app does that after calling it.
export function moveCard(store, key, fromBin, toBin, qty = 1){
  const c = store.cards[key];
  if (!c) return false;
  const have = c.bins[fromBin] || 0;
  const n = Math.min(qty, have);
  if (n <= 0) return false;
  c.bins[fromBin] = have - n;
  if (c.bins[fromBin] === 0) delete c.bins[fromBin];
  c.bins[toBin] = (c.bins[toBin] || 0) + n;
  return true;
}
