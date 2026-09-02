"""Turn parser records into the published data model (rounds, runs) with recomputed values."""
import os, re, json, hashlib, datetime
from decimal import Decimal
from . import scoring
from .config import slug

ROUND_TEXT = {'Q': 'Qualification', 'Q1': 'Qualification 1', 'Q2': 'Qualification 2',
              'F1': 'Final 1', 'F2': 'Final 2', 'F3': 'Final 3'}
MONTHS = {m: i for i, m in enumerate(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], start=1)}


def f2(x):
    """Decimal/float -> float with at most 2 decimals (JSON)."""
    if x is None:
        return None
    return float(scoring.trunc(x)) if isinstance(x, Decimal) else float(x)


def iso_date(fis_date):
    """'SAT 30 NOV 2024' -> '2024-11-30'"""
    m = re.search(r'(\d{1,2})\s+([A-Z]{3})\s+(\d{4})', fis_date or '')
    if not m:
        return None
    return f"{int(m.group(3)):04d}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def judge_id(name, noc):
    return 'j-' + slug(name) + ('-' + noc.lower() if noc else '')


def make_round(cls, meta, records, rules, rules_version, event_id, imported_at):
    codex = cls['codex'] or meta.get('codex')
    round_id = f"{cls['season']}-{codex}-{cls['round']}"
    judges = [{'no': j['judge_no'], 'role': j['role'], 'judge_id': judge_id(j['name'], j['noc']),
               'name': j['name'], 'noc': j['noc']} for j in meta.get('judges', [])]
    rnd = {
        'round_id': round_id, 'event_id': event_id, 'codex': codex, 'season': cls['season'], 'series': cls['series'],
        'format': cls['format'], 'gender': cls['gender'], 'round': cls['round'], 'round_text': ROUND_TEXT[cls['round']],
        'date': iso_date(meta.get('date')), 'date_text': meta.get('date'), 'start_time': meta.get('start_time'),
        'venue': meta.get('venue'), 'n_competitors': meta.get('num_competitors'),
        'pace_time': meta.get('pace_time'),
        'course': {'name': None, 'length_m': meta.get('course_length_m'), 'width_m': meta.get('course_width_m'),
                   'gate_width_m': meta.get('gate_width_m'), 'gradient_deg': meta.get('gradient_deg')},
        'judges': judges, 'officials': meta.get('officials', []),
        'q_layout': bool(meta.get('q_layout')),
        'source': {'pdf': cls['rel'], 'pdf_sha256': sha256_file(cls['path']), 'fis_url': None,
                   'report_created': None, 'imported_at': imported_at,
                   'parser_version': meta.get('parser_version'), 'rules_version': rules_version},
        'verification': {},
    }
    runs = []
    for rec in records:
        run = make_run(rec, rnd, rules)
        runs.append(run)
    return rnd, runs


def make_run(rec, rnd, rules):
    suffix = '' if rec['counting'] else '-Q1ref'
    run = {
        'run_id': f"{rnd['round_id']}-{rec['fis_code']}{suffix}",
        'round_id': rnd['round_id'], 'event_id': rnd['event_id'], 'season': rnd['season'], 'series': rnd['series'],
        'gender': rnd['gender'], 'round': rnd['round'], 'date': rnd['date'],
        'rank': rec['rank'], 'bib': rec['bib'], 'fis_code': rec['fis_code'], 'athlete_id': rec['fis_code'],
        'name': rec['name'], 'noc': rec['noc'], 'yb': rec['yb'],
        'status': rec['status'], 'reserve_judge': bool(rec.get('reserve_judge')),
        'seconds': None, 'time_points': None, 'air': [], 'air_total': None,
        'base': [], 'base_discard': [], 'base_total': None,
        'ded': [], 'ded_discard': [], 'ded_total': None,
        'turns_total': None, 'turns_floor_applied': False, 'run_score': None, 'tie': rec.get('tie'),
        'q_block': rec.get('q_block'), 'counting': bool(rec.get('counting')), 'best_score': rec.get('best_score'),
        'components': None,
        'provenance': {'pdf': rnd['source']['pdf'], 'page': rec.get('page'),
                       'parser_version': rnd['source']['parser_version'], 'rules_version': rnd['source']['rules_version']},
        # printed values kept for verification (removed before publishing)
        '_printed': {k: rec.get(k) for k in ('time_points', 'air_total', 'base_total', 'ded_total', 'turns_total', 'run_score')},
    }
    if rec['status'] != 'OK':
        return run
    rc = scoring.recompute(rec, rnd['pace_time'], rules)
    run['seconds'] = rec['seconds']
    run['time_points'] = f2(rc['time_points']) if rc['time_points'] is not None else rec['time_points']
    run['air'] = [{'J6': j['J6'], 'J7': j['J7'], 'jump': j['jump'], 'dd': j['DD'],
                   'v6': f2(p[0]), 'v7': f2(p[1]), 'jump_score': float(p[2])}
                  for j, p in zip(rec['air_jumps'], rc['air_parts'])]
    run['air_total'] = f2(rc['air_total'])
    run['base'] = rec['base_scores']; run['base_discard'] = rc['base_discard']; run['base_total'] = f2(rc['base_total'])
    run['ded'] = rec['ded_scores']; run['ded_discard'] = rc['ded_discard']; run['ded_total'] = f2(rc['ded_total'])
    run['turns_total'] = f2(rc['turns_total']); run['turns_floor_applied'] = rc['turns_floor_applied']
    run['run_score'] = f2(rc['run_score'])
    run['_recomputed'] = rc
    return run
