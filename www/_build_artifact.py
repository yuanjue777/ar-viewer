#!/usr/bin/env python3
"""把 rpg.html + rpg.css + rpg.js 合成 Artifact 用的单文件（去掉 doctype/html/head/body/meta）。
用法: python3 www/_build_artifact.py <输出路径>
"""
import os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '_artifact.html')

html = open(os.path.join(here, 'rpg.html'), encoding='utf-8').read()
css  = open(os.path.join(here, 'rpg.css'),  encoding='utf-8').read()
js   = open(os.path.join(here, 'rpg.js'),   encoding='utf-8').read()

body = re.search(r'<body[^>]*>(.*)</body>', html, re.S).group(1)
title = re.search(r'<title>(.*?)</title>', html, re.S).group(1)

open(out, 'w', encoding='utf-8').write(
    f'<title>{title}</title>\n<style>\n{css}\n</style>\n{body}\n<script>\n{js}\n</script>\n')
print('built', out)
