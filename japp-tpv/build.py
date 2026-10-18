#!/usr/bin/env python3
"""Mete un TPV de una sola página (tpv-japp.html) dentro de index.html de la PWA y sube la versión del service worker.
Uso: python3 build.py ruta/a/tpv-japp.html"""
import re, sys, pathlib
here = pathlib.Path(__file__).parent
src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
idx = (here / "index.html").read_text(encoding="utf-8")
a = '<meta name="apple-mobile-web-app-title" content="Japp TPV">\n'; b = '\n<script>\nif("serviceWorker"'
i = idx.index(a) + len(a); j = idx.index(b)
(here / "index.html").write_text(idx[:i] + src.rstrip("\n") + idx[j:], encoding="utf-8")
ver = re.search(r"APP_VER=(\d+)", src).group(1)
sw = (here / "sw.js").read_text(encoding="utf-8")            # leer antes de escribir
(here / "sw.js").write_text(re.sub(r"japp-tpv-v\d+", f"japp-tpv-v{ver}", sw), encoding="utf-8")
print(f"TPV v{ver} empaquetado")
