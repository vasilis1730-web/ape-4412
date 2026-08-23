#!/usr/bin/env python3
"""Συντακτικός έλεγχος κάθε script block του index.html.

Η εφαρμογή είναι ένα αρχείο χωρίς build step, οπότε ένα συντακτικό λάθος
δεν το πιάνει κανένας μεταγλωττιστής — φαίνεται μόνο όταν σπάσει η σελίδα.
"""
import re, subprocess, sys, tempfile, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")
blocks = re.findall(r"<script>(.*?)</script>", html, re.S)
if not blocks:
    sys.exit("Δεν βρέθηκε κανένα script block στο index.html")

fail = 0
with tempfile.TemporaryDirectory() as td:
    for i, b in enumerate(blocks):
        f = pathlib.Path(td) / f"block{i}.js"
        f.write_text(b, encoding="utf-8")
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
        if r.returncode:
            fail += 1
            print(f"✗ block {i}:\n{r.stderr.strip()}\n")

for extra in ("config.js",):
    p = root / extra
    if p.exists():
        r = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
        if r.returncode:
            fail += 1
            print(f"✗ {extra}:\n{r.stderr.strip()}\n")

print(f"{len(blocks)} script blocks ελέγχθηκαν — {'ΚΑΘΑΡΟ' if not fail else str(fail)+' με σφάλμα'}")
sys.exit(1 if fail else 0)
