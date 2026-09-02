"""data/ の events ファイルから fis_url を拾って etl/fis_urls.json に保存する（--fis 実行の結果を次回以降にも使うため）。"""
import os, sys, json
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from etl import config
man = json.load(open(os.path.join(config.DATA_DIR, 'manifest.json'), encoding='utf-8'))
events = json.load(open(os.path.join(config.DATA_DIR, man['files']['events']), encoding='utf-8'))
cache = json.load(open(config.FIS_URLS, encoding='utf-8')) if os.path.exists(config.FIS_URLS) else {}
n = 0
for e in events:
    for r in e['rounds']:
        u = r.get('source', {}).get('fis_url')
        if u:
            cache[r['round_id']] = u; n += 1
json.dump(cache, open(config.FIS_URLS, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(f"fis_url {n} 件を {config.FIS_URLS} に保存（合計 {len(cache)} 件）")
