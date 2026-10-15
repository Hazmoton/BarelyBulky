// YOUR MODULE: everything that moves cards between bins lives here, so you can rewrite it freely.
// store shape:
//   { bins:  { [binId]: { id, name, type: 'storage' | 'deck' } },
//     cards: { [cardName]: { name, bins: { [binId]: quantity }, ...scryfall fields } } }
// Returns true if anything moved.
export function moveCard(store, name, fromBin, toBin, qty = 1){
  const c = store.cards[name];
  if (!c) return false;
  const have = c.bins[fromBin] || 0;
  const n = Math.min(qty, have);
  if (n <= 0) return false;
  c.bins[fromBin] = have - n;
  if (c.bins[fromBin] === 0) delete c.bins[fromBin];
  c.bins[toBin] = (c.bins[toBin] || 0) + n;
  return true;
}
