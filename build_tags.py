#!/usr/bin/env python3
"""Build tags.json for Bulk Sorter from Scryfall's "oracle_tags" bulk export (community functional tags).

Run from the repo folder, then commit and push tags.json next to index.html:
    python build_tags.py                          # every card on Scryfall
    python build_tags.py --collection backup.json # only cards you own (backup JSON or CSV from the app)
    python build_tags.py --min-weight strong      # drop weaker taggings (weak, median, strong, verystrong)
    python build_tags.py --file oracle_tags.json  # use a bulk file you already downloaded
Standard library only. The app falls back to live Scryfall queries for any card tags.json doesn't cover.
"""
import argparse, csv, gzip, json, re, sys
import urllib.request
from datetime import datetime, timezone

BULK_INDEX = 'https://api.scryfall.com/bulk-data'
HEADERS = {'User-Agent': 'BulkSorterTagBuilder/1.0', 'Accept': 'application/json;q=0.9,*/*;q=0.8'}  # Scryfall requires both
WEIGHTS = {'weak': 0, 'median': 1, 'strong': 2, 'verystrong': 3}


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    return gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data


def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def weight_rank(w):  # "VeryStrong", "very_strong", "Median"... -> 0..3 (unknown counts as median)
    return WEIGHTS.get(re.sub(r'[^a-z]', '', str(w).lower()), 1)


def owned_oracle_ids(path):
    ids = set()
    if path.lower().endswith('.csv'):
        with open(path, newline='', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                if row.get('Oracle ID'):
                    ids.add(row['Oracle ID'])
    else:
        with open(path, encoding='utf-8') as f:
            for c in json.load(f).get('cards', {}).values():
                if c.get('oracle_id'):
                    ids.add(c['oracle_id'])
    return ids


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='tags.json')
    ap.add_argument('--file', help='local oracle_tags bulk file instead of downloading')
    ap.add_argument('--collection', help='only keep cards listed in this app backup (.json) or CSV export')
    ap.add_argument('--min-weight', default='weak', choices=list(WEIGHTS))
    a = ap.parse_args()

    updated = None
    if a.file:
        raw = open(a.file, 'rb').read()
        raw = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    else:
        print('Looking up bulk files...')
        index = json.loads(fetch(BULK_INDEX))['data']
        entry = next((e for e in index if e.get('type') == 'oracle_tags'), None)
        if not entry:
            sys.exit('No "oracle_tags" bulk file in the list. Available types: ' + ', '.join(e.get('type', '?') for e in index) +
                     '\nDownload the tags file by hand and pass it with --file.')
        updated = entry.get('updated_at')
        print(f"Downloading oracle_tags ({entry.get('size', 0) / 1e6:.1f} MB, updated {updated})...")
        raw = fetch(entry['download_uri'])

    tags = json.loads(raw)
    if isinstance(tags, dict):
        tags = tags.get('data', [])
    floor = WEIGHTS[a.min_weight]
    cards, labels = {}, {}
    for t in tags:
        ttype = t.get('type') or t.get('tag_type')
        if ttype and str(ttype).lower() != 'oracle':
            continue  # skip illustration tags if the file mixes them in
        label = t.get('label') or t.get('name') or ''
        slug = t.get('slug') or slugify(label)
        if not slug:
            continue
        for g in t.get('taggings') or []:
            oid = g.get('oracle_id')
            if oid and weight_rank(g.get('weight', 'median')) >= floor:
                cards.setdefault(oid, set()).add(slug)
                labels[slug] = label or slug.replace('-', ' ')
    if not cards:
        sample = tags[0] if tags else None
        sys.exit('Found no oracle taggings. First entry looked like: ' + (json.dumps(sample)[:600] if sample else '(file was empty)'))

    complete = not a.collection
    covered = None
    if a.collection:
        covered = owned_oracle_ids(a.collection)
        cards = {k: v for k, v in cards.items() if k in covered}
    used = {s for v in cards.values() for s in v}
    out = {
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source_updated': updated,
        'complete': complete,
        'tags': {s: {'label': labels[s]} for s in sorted(used)},
        'cards': {k: sorted(v) for k, v in sorted(cards.items())},
    }
    if covered is not None:
        out['covered'] = sorted(covered)
    text = json.dumps(out, separators=(',', ':'))
    open(a.out, 'w', encoding='utf-8').write(text)
    gz = len(gzip.compress(text.encode(), 9))
    print(f"Wrote {a.out}: {len(used)} tags, {len(cards)} cards with tags, {len(text) / 1e6:.1f} MB ({gz / 1e6:.1f} MB as served gzipped).")
    if len(text) > 40e6:
        print('That is large for a phone download and close to GitHub\'s 50 MB warning. Re-run with --collection your-backup.json')
    elif complete:
        print('Commit and push it next to index.html.')


if __name__ == '__main__':
    main()
