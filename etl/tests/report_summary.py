"""Print a compact summary of docs/検証レポート.md (errors by layer, first N messages)."""
import re, sys, os, collections
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'docs', '検証レポート.md')
n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
t = open(path, encoding='utf-8').read()
err = [l for l in t.split('## エラー')[1].split('## 警告')[0].split('\n') if l.startswith('- ')]
warn = [l for l in t.split('## 警告')[1].split('## ラウンド別')[0].split('\n') if l.startswith('- ')]
print("ERRORS:", len(err), dict(collections.Counter(re.match(r'- \[(\w+)\]', l).group(1) for l in err)))
print("\n".join(err[:n]))
w2 = [l for l in warn if '新しいラウンド' not in l]
print("\nWARNINGS:", len(warn), "(excluding new-round:", len(w2), ")", dict(collections.Counter(re.match(r'- \[(\w+)\]', l).group(1) for l in w2)))
print("\n".join(w2[:n]))
