"""Paths, season/series mapping, and result-file naming rules for the moguls-results ETL."""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
# Source PDFs live outside the repo (read-only). Override with MOGULS_PDF_ROOT.
PDF_ROOT = os.environ.get('MOGULS_PDF_ROOT', os.path.join(os.path.dirname(REPO), '全試合のリザルト'))
# PDFs fetched by the auto-update workflow are placed inside the repo.
PDF_ROOT_EXTRA = os.path.join(REPO, 'source_pdfs')
DATA_DIR = os.path.join(REPO, 'data')
DOCS_DIR = os.path.join(REPO, 'docs')
GOLDEN_DIR = os.path.join(REPO, 'golden')
RULES_DIR = os.path.join(HERE, 'rules')

EXPECTED_ROUNDS = os.path.join(HERE, 'expected_rounds.json')
PUBLISHED_HASHES = os.path.join(HERE, 'published_hashes.json')
ATHLETE_ALIASES = os.path.join(HERE, 'athlete_aliases.json')
ATHLETE_OVERRIDES = os.path.join(HERE, 'athlete_overrides.json')
JUDGE_OVERRIDES = os.path.join(HERE, 'judge_overrides.json')
FIS_URLS = os.path.join(HERE, 'fis_urls.json')
KNOWN_GAPS = os.path.join(HERE, 'known_gaps.json')
LAYER5_CACHE = os.path.join(HERE, 'layer5_status.json')

# Top-level source folders -> (season, series, format). Season folders are World Cup.
FOLDER_MAP = {
    '2022-23シーズン': ('2022-23', 'WC', 'wc_traditional'),
    '2023-24シーズン': ('2023-24', 'WC', 'wc_traditional'),
    '2024-25シーズン': ('2024-25', 'WC', 'wc_traditional'),
    '2025-26シーズン': ('2025-26', 'WC', 'wc_traditional'),
    '2026-27シーズン': ('2026-27', 'WC', 'wc_traditional'),
    'オリンピック/北京オリンピック2022': ('2021-22', 'OWG', 'owg_2022'),
    'オリンピック/Milano Cortina': ('2025-26', 'OWG', 'championship'),
    '世界選手権/Bakuriani': ('2022-23', 'WSC', 'championship'),
    '世界選手権/Engadin': ('2024-25', 'WSC', 'championship'),
}

ROUND_MAP = {'予選': 'Q', '予選1': 'Q1', '予選2': 'Q2', '決勝1': 'F1', '決勝2': 'F2', '決勝3': 'F3', '決勝': 'F1'}
GENDER_MAP = {'男子': 'M', '女子': 'W'}

FNAME_RE = re.compile(r'^(?P<venue>.+?)_(?P<gender>男子|女子)モーグル(?P<round>予選1|予選2|予選|決勝1|決勝2|決勝3|決勝)_(?P<codex>\d{3,5})\.pdf$')
FNAME_BEIJING_RE = re.compile(r'^北京オリンピック_(?P<gender>男子|女子)(?P<round>予選1|予選2|決勝1|決勝2|決勝3)\.pdf$')


def classify_pdf(path):
    """Return a dict {season, series, format, venue_key, gender, round, codex(str|None), rel} for a
    single-run moguls result PDF, or None if the file is not in scope (dual moguls, unknown name)."""
    root = PDF_ROOT if path.startswith(PDF_ROOT) else PDF_ROOT_EXTRA
    rel = os.path.relpath(path, root).replace('\\', '/')
    fname = os.path.basename(path)
    if 'デュアル' in fname or not fname.lower().endswith('.pdf'):
        return None
    folder = None
    for key in sorted(FOLDER_MAP, key=len, reverse=True):
        if rel.startswith(key + '/'):
            folder = key
            break
    if folder is None:
        return None
    season, series, fmt = FOLDER_MAP[folder]
    m = FNAME_RE.match(fname)
    if m:
        venue_key, gender, rnd, codex = m.group('venue'), m.group('gender'), m.group('round'), m.group('codex')
    else:
        m = FNAME_BEIJING_RE.match(fname)
        if not m:
            return None
        venue_key, gender, rnd, codex = 'Beijing', m.group('gender'), m.group('round'), None
    return {'season': season, 'series': series, 'format': fmt, 'venue_key': venue_key,
            'gender': GENDER_MAP[gender], 'round': ROUND_MAP[rnd], 'codex': codex, 'rel': rel, 'path': path}


def list_source_pdfs():
    out = []
    for root in (PDF_ROOT, PDF_ROOT_EXTRA):
        if not os.path.isdir(root):
            continue
        for r, dirs, fs in os.walk(root):
            dirs[:] = [d for d in dirs if not d.startswith('_') and not d.startswith('.')]
            for f in sorted(fs):
                c = classify_pdf(os.path.join(r, f))
                if c:
                    out.append(c)
    return sorted(out, key=lambda c: (c['season'], c['series'], c['venue_key'], c['gender'], c['round']))


def slug(s):
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip('-').lower()
    return s or 'x'
