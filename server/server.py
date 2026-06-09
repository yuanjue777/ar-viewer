# -*- coding: utf-8 -*-
# 模型库后端 —— 纯 Python 标准库，无需 pip 安装任何依赖。
# 提供：管理端页面、模型列表/上传/删除接口、模型文件下载。
import json, os, uuid, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(ROOT, 'library')
INDEX = os.path.join(ROOT, 'library.json')
os.makedirs(LIB_DIR, exist_ok=True)
PORT = 8000


def load_index():
    if os.path.exists(INDEX):
        try:
            with open(INDEX, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_index(items):
    with open(INDEX, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self._cors()
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, fp, ctype):
        if not os.path.exists(fp):
            return self._json({'error': 'not found'}, 404)
        with open(fp, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self._cors()
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        path = p.path
        if path in ('/', '/admin', '/admin.html'):
            return self._file(os.path.join(ROOT, 'admin.html'), 'text/html; charset=utf-8')
        if path in ('/viewer', '/viewer.html'):
            return self._file(os.path.join(ROOT, 'viewer.html'), 'text/html; charset=utf-8')
        if path == '/api/models':
            return self._json(load_index())
        if path.startswith('/library/'):
            fname = os.path.basename(urllib.parse.unquote(path[len('/library/'):]))
            return self._file(os.path.join(LIB_DIR, fname), 'model/gltf-binary')
        # 静态文件兜底（PWA 图标 / manifest 等，放在 server/ 目录）
        rel = os.path.basename(urllib.parse.unquote(path.lstrip('/')))
        if rel:
            fp = os.path.join(ROOT, rel)
            if os.path.isfile(fp):
                ext = rel.lower().rsplit('.', 1)[-1]
                ctype = {'png': 'image/png', 'jpg': 'image/jpeg', 'svg': 'image/svg+xml',
                         'json': 'application/manifest+json', 'webmanifest': 'application/manifest+json',
                         'html': 'text/html; charset=utf-8', 'js': 'text/javascript',
                         'css': 'text/css'}.get(ext, 'application/octet-stream')
                return self._file(fp, ctype)
        return self._json({'error': 'not found'}, 404)

    def do_POST(self):
        p = urllib.parse.urlparse(self.path)
        if p.path == '/api/upload':
            q = urllib.parse.parse_qs(p.query)
            name = (q.get('name', ['未命名'])[0]).strip() or '未命名'
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0:
                return self._json({'error': 'empty body'}, 400)
            data = self.rfile.read(length)
            mid = uuid.uuid4().hex[:12]
            safe = mid + '.glb'
            with open(os.path.join(LIB_DIR, safe), 'wb') as f:
                f.write(data)
            item = {'id': mid, 'name': name, 'file': safe,
                    'size': len(data), 'uploaded': int(time.time())}
            items = load_index()
            items.insert(0, item)
            save_index(items)
            return self._json(item)
        return self._json({'error': 'not found'}, 404)

    def do_DELETE(self):
        p = urllib.parse.urlparse(self.path)
        if p.path.startswith('/api/models/'):
            mid = p.path[len('/api/models/'):]
            items, keep = load_index(), []
            for it in items:
                if it.get('id') == mid:
                    try:
                        os.remove(os.path.join(LIB_DIR, it['file']))
                    except Exception:
                        pass
                else:
                    keep.append(it)
            save_index(keep)
            return self._json({'ok': True})
        return self._json({'error': 'not found'}, 404)

    def log_message(self, fmt, *args):
        pass  # 静默


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), H)
    print('模型库服务已启动: http://0.0.0.0:%d  (管理端: /admin)' % PORT)
    srv.serve_forever()
