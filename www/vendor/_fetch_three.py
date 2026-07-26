#!/usr/bin/env python3
"""下载 three.js 并打包成 www/vendor/three.min.js（普通 <script> 可直接用，暴露 window.THREE）。

three r168+ 把发布产物拆成了 three.core.min.js + three.module.min.js（后者 import 前者），
而且都是 ESM。这个脚本把两个 ESM 各自包进一个 IIFE、把 import/export 改写成对象传递，
产出一个自包含的经典脚本 —— Artifact 的 CSP 不许外链，必须能整段内联。

用法: python3 www/vendor/_fetch_three.py [版本号，默认 0.180.0]
⚠️ 产物 three.min.js 是压缩过的第三方代码，永远不要去读它。
"""
import os, re, sys, urllib.request

VER = sys.argv[1] if len(sys.argv) > 1 else '0.180.0'
BASE = f'https://unpkg.com/three@{VER}/build/'
here = os.path.dirname(os.path.abspath(__file__))


def fetch(name):
    with urllib.request.urlopen(BASE + name) as r:
        return r.read().decode('utf-8')


def split_list(text):
    """'a as B,c,d as E' -> [(a, B), (c, c), (d, E)]"""
    out = []
    for p in text.split(','):
        p = p.strip()
        if not p:
            continue
        if ' as ' in p:
            a, b = p.split(' as ')
            out.append((a.strip(), b.strip()))
        else:
            out.append((p, p))
    return out


def take_exports(src, ns_expr=None):
    """摘掉所有 export{...} / export{...}from"..." 语句。
    后者是转发导出（名字其实来自被 import 的模块），要解析成 ns.名字。
    返回 (剩余代码, {导出名: 取值表达式})"""
    exports = {}
    for m in list(re.finditer(r'export\{(.*?)\}(from"[^"]*")?;?', src, re.S))[::-1]:
        fwd = m.group(2) is not None
        for local, name in split_list(m.group(1)):
            exports[name] = f'{ns_expr}.{local}' if fwd else local
        src = src[:m.start()] + src[m.end():]
    return src, exports


def wrap(src, ns_expr=None):
    """ESM 源码 -> IIFE，返回其导出对象"""
    for m in list(re.finditer(r'import\{(.*?)\}from"[^"]*";', src, re.S))[::-1]:
        assert ns_expr, 'import found but no namespace given'
        binds = ','.join(f'{local}={ns_expr}.{name}' for name, local in split_list(m.group(1)))
        src = src[:m.start()] + f'const {binds};' + src[m.end():]
    src, exports = take_exports(src, ns_expr)
    assert 'from"./three' not in src, 'still has unhandled import/export'
    ret = ','.join(f'{name}:{local}' for name, local in exports.items())
    return '(function(){\n' + src + '\nreturn{' + ret + '};\n})()', len(exports)


core, n_core = wrap(fetch('three.core.min.js'))
mod, n_mod = wrap(fetch('three.module.min.js'), '__C')

out = (';(function(){\nvar __C=' + core + ';\nvar __T=' + mod +
       ';\nwindow.THREE=Object.assign({},__C,__T);\n})();\n')
path = os.path.join(here, 'three.min.js')
open(path, 'w', encoding='utf-8').write(out)
print(f'three {VER} -> {path}  ({len(out)//1024} KB, core {n_core} + module {n_mod} exports)')
