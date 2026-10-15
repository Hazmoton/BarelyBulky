// Finds a Magic card anywhere in a camera frame and flattens it into an upright 630x880 image.
// Works on OpenCV.js Mats; the caller owns (and must delete) the Mats it passes in.
export const CARD_W = 630, CARD_H = 880;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// order four points as top-left, top-right, bottom-right, bottom-left
export function orderQuad(p){
  const bySum = [...p].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...p].sort((a, b) => (a.y - a.x) - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}
function quadInfo([tl, tr, br, bl]){
  const w = (dist(tl, tr) + dist(bl, br)) / 2, h = (dist(tl, bl) + dist(tr, br)) / 2;
  return { w, h, ratio: Math.min(w, h) / Math.max(w, h) };
}

// returns 4 corners (tl, tr, br, bl) in src pixel coordinates, or null if no card-shaped outline is found
export function findCard(cv, src){
  const s = Math.min(1, 640 / src.cols);
  const small = new cv.Mat(), gray = new cv.Mat(), edges = new cv.Mat(), hier = new cv.Mat();
  const contours = new cv.MatVector();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  let best = null;
  try {
    cv.resize(src, small, new cv.Size(Math.round(src.cols * s), Math.round(src.rows * s)), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 35, 110);
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2); // thicken edges so small gaps in the outline close
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const frameArea = small.cols * small.rows;
    for (let i = 0; i < contours.size(); i++){
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < frameArea * 0.06 || area > frameArea * 0.97){ c.delete(); continue; }
      const peri = cv.arcLength(c, true);
      let quad = null;
      for (const eps of [0.02, 0.03, 0.045]){
        const ap = new cv.Mat();
        cv.approxPolyDP(c, ap, eps * peri, true);
        if (ap.rows === 4 && cv.isContourConvex(ap)){
          quad = [];
          for (let k = 0; k < 4; k++) quad.push({ x: ap.data32S[k * 2], y: ap.data32S[k * 2 + 1] });
        }
        ap.delete();
        if (quad) break;
      }
      if (!quad){ // rounded corners or a noisy outline: fall back to the tightest rotated rectangle
        const r = cv.minAreaRect(c);
        if (r.size.width * r.size.height > 0 && area / (r.size.width * r.size.height) > 0.85)
          quad = cv.RotatedRect.points(r).map(p => ({ x: p.x, y: p.y }));
      }
      c.delete();
      if (!quad) continue;
      const o = orderQuad(quad), { ratio } = quadInfo(o);
      if (ratio < 0.6 || ratio > 0.84) continue; // real card is ~0.716; allow for tilt
      const score = area * (1 - Math.abs(ratio - 0.716));
      if (!best || score > best.score) best = { score, quad: o };
    }
  } finally {
    small.delete(); gray.delete(); edges.delete(); hier.delete(); contours.delete(); kernel.delete();
  }
  return best ? best.quad.map(p => ({ x: p.x / s, y: p.y / s })) : null;
}

// flatten the card into an upright CARD_W x CARD_H Mat (caller deletes it)
export function warpCard(cv, src, quad){
  let [tl, tr, br, bl] = orderQuad(quad);
  const { w, h } = quadInfo([tl, tr, br, bl]);
  if (w > h) [tl, tr, br, bl] = [bl, tl, tr, br]; // card is on its side: stand it up (the 180° retry covers the other direction)
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, CARD_W, 0, CARD_W, CARD_H, 0, CARD_H]);
  const M = cv.getPerspectiveTransform(from, to);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, M, new cv.Size(CARD_W, CARD_H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
  from.delete(); to.delete(); M.delete();
  return out;
}
