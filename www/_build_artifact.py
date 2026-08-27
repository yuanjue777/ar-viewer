#!/usr/bin/env python3
"""把 rpg.html + rpg.css + vendor/three.min.js + rpg3d.js + rpg.js 合成 Artifact 用的单文件
（去掉 doctype/html/head/body/meta，所有 <script src> 全部内联，Artifact 的 CSP 不许外链）。
用法: python3 www/_build_artifact.py <输出路径>
"""
import os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '_artifact.html')

def read(p):
    return open(os.path.join(here, p), encoding='utf-8').read()

html = read('rpg.html')
css  = read('rpg.css')
# 顺序不能变：three 先定义 window.THREE，rpg3d 建 R3，rpg 最后启动
scripts = ['vendor/three.min.js', 'rpg3d.js', 'rpg.js']

body = re.search(r'<body[^>]*>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script\b[^>]*\bsrc=[^>]*></script>\s*', '', body)   # 去掉外链标签，改成内联
title = re.search(r'<title>(.*?)</title>', html, re.S).group(1)

parts = [f'<title>{title}</title>', f'<style>\n{css}\n</style>', body]
for s in scripts:
    parts.append(f'<script>\n{read(s)}\n</script>')

open(out, 'w', encoding='utf-8').write('\n'.join(parts) + '\n')
print('built', out, os.path.getsize(out) // 1024, 'KB')
