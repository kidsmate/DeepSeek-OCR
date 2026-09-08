#!/usr/bin/env python3
"""HTTP server with PDF TOC extraction API"""
import http.server
import json
import os
import re
import io
from urllib.parse import unquote

PORT = 8080
ROOT = os.path.dirname(os.path.abspath(__file__))

# 人教版初中语文目录正则
UNIT_RE = re.compile(r'(?:第[一二三四五六七八九十百零〇两0-9]+(?:单元|章|节|部分|编|组)|Unit\s*\d+|单元\s*[一二三四五六七八九十百零〇两0-9]+)')
GROUP_KEYWORDS = ['阅读', '写作', '任务', '综合性学习', '课外古诗词诵读', '课外古诗词',
                  '名著导读', '口语交际', '活动·探究', '活动探究', '诵读',
                  '课文', '古诗词', '思考探究', '积累拓展', '读读写写', '写作实践',
                  '研讨与练习', '汉语知识', '语法知识']
LESSON_PATTERNS = [
    re.compile(r'^(\d+)\*?\s*[.．、]?\s*(.+)'),
    re.compile(r'^([一二三四五六七八九十]+)[、.．]\s*(.+)'),
]


def _is_running_header(text_pages_map, text, total_pages):
    """判断某行文本是否为页眉/页脚（在多页重复出现）。"""
    pages = text_pages_map.get(text)
    if not pages:
        return False
    # 同一文本出现在 >5 页 或 > 总页数 10% → 视为页眉页脚
    if len(pages) > 5 or len(pages) > max(3, total_pages * 0.1):
        return True
    return False


def _compute_endpages(units, total_pages):
    """为所有 lesson 计算 endPage = 下一篇 startPage - 1。"""
    all_lessons = [l for u in units for l in u['lessons'] if l['type'] == 'lesson']
    for i, lesson in enumerate(all_lessons):
        if 'startPage' not in lesson:
            lesson['startPage'] = 1
        nxt = all_lessons[i + 1]['startPage'] if i + 1 < len(all_lessons) else total_pages + 1
        lesson['endPage'] = max(lesson['startPage'], nxt - 1)
        if lesson['endPage'] > total_pages:
            lesson['endPage'] = total_pages
    return units


def extract_toc_with_fitz(pdf_bytes):
    """用 pymupdf 提取目录。

    关键原则（确保书签与正文一一对应、点击即达正文）：
    1. 优先使用 PDF 自带书签（doc.get_toc），忠实保留原始层级与页码，不做正则过滤；
    2. 无书签时按字体大小聚类扫描：标题字号 = 严格大于正文字号，按字号间隔聚类为 3 级；
    3. 过滤页眉页脚（在多页重复出现的行）；
    4. 页码即真实 PDF 页码（page_idx+1），pageOffset 恒为 0——无需任何偏移修正。
    """
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)

    # 1. 优先使用 PDF 自带书签（最准确，页码即真实 PDF 页码）
    existing_toc = doc.get_toc()
    if existing_toc:
        result = parse_existing_toc(existing_toc, total_pages)
        if result['units']:
            doc.close()
            return result

    # 2. 按字体大小聚类扫描
    all_lines = []      # [{page, text, fontsize, y}]
    font_count = {}
    text_pages = {}     # text -> set(pages)，用于检测页眉页脚

    for page_idx in range(total_pages):
        page = doc[page_idx]
        blocks = page.get_text("dict")["blocks"]
        for blk in blocks:
            if blk.get("type", 0) != 0:
                continue
            for line in blk.get("lines", []):
                line_text = ""
                line_max_font = 0.0
                line_y = 0.0
                for span in line.get("spans", []):
                    if not span["text"].strip():
                        continue
                    line_text += span["text"]
                    fs = round(float(span["size"]), 1)
                    if fs > line_max_font:
                        line_max_font = fs
                    line_y = float(span["bbox"][1])
                line_text = line_text.strip()
                if len(line_text) < 2 or len(line_text) > 60:
                    continue
                # 过滤纯页码行
                if re.fullmatch(r'[\-—\s]*\d{1,4}[\-—\s]*', line_text):
                    continue
                fs_key = str(line_max_font)
                font_count[fs_key] = font_count.get(fs_key, 0) + 1
                all_lines.append({
                    'page': page_idx + 1,
                    'text': line_text,
                    'fontsize': line_max_font,
                    'y': round(line_y, 1)
                })
                text_pages.setdefault(line_text, set()).add(page_idx + 1)

    doc.close()

    if not all_lines:
        return {'units': [], 'pageOffset': 0, 'totalPages': total_pages, 'method': 'none'}

    # 正文字号 = 出现次数最多的字号
    body_font = float(max(font_count.items(), key=lambda x: x[1])[0])

    # 标题行 = 字号严格大于正文（> body + 0.5），并剔除页眉页脚
    title_lines = [
        l for l in all_lines
        if l['fontsize'] > body_font + 0.5
        and not _is_running_header(text_pages, l['text'], total_pages)
    ]
    if not title_lines:
        return {'units': [], 'pageOffset': 0, 'totalPages': total_pages,
                'method': 'none', 'bodyFont': body_font}

    # 按字号聚类：降序排列，相邻字号差 > 1.0 视为不同层级
    title_sizes = sorted(set(l['fontsize'] for l in title_lines), reverse=True)
    clusters = []          # 每个簇是该层级的字号列表
    cur = [title_sizes[0]]
    for i in range(1, len(title_sizes)):
        if cur[-1] - title_sizes[i] > 1.0:
            clusters.append(cur)
            cur = []
        cur.append(title_sizes[i])
    clusters.append(cur)

    # 字号 → 层级映射：簇按代表字号（均值）降序对应 L1/L2/L3（最多 3 级）
    cluster_reps = [sum(c) / len(c) for c in clusters]
    order = sorted(range(len(clusters)), key=lambda k: cluster_reps[k], reverse=True)
    size_to_level = {}
    for rank, ck in enumerate(order):
        level = rank + 1 if rank < 2 else 3   # 第1大簇→L1，第2大→L2，其余→L3
        for sz in clusters[ck]:
            size_to_level[sz] = level

    # 构建目录树（忠实保留每一条标题行，不按正则过滤）
    units = []
    cur_unit = None

    for line in title_lines:
        text = line['text'].strip()
        page = line['page']
        fs = line['fontsize']
        lvl = size_to_level.get(fs, 3)

        if lvl == 1:
            cur_unit = {'title': text, 'page': page, 'lessons': []}
            units.append(cur_unit)
        elif lvl == 2:
            if cur_unit is None:
                cur_unit = {'title': '未命名单元', 'page': page, 'lessons': []}
                units.append(cur_unit)
            # 含栏目关键词 → 栏目，否则 → 课文
            is_group = any(text == kw or text.startswith(kw) for kw in GROUP_KEYWORDS)
            if is_group:
                cur_unit['lessons'].append({'title': text, 'type': 'group', 'page': page})
            else:
                cur_unit['lessons'].append({'title': text, 'type': 'lesson', 'startPage': page})
        else:  # level 3
            if cur_unit is None:
                cur_unit = {'title': '未命名单元', 'page': page, 'lessons': []}
                units.append(cur_unit)
            cur_unit['lessons'].append({'title': text, 'type': 'lesson', 'startPage': page})

    # 计算 endPage
    units = _compute_endpages(units, total_pages)

    # 过滤掉没有课文的单元
    units = [u for u in units if any(l['type'] == 'lesson' for l in u['lessons'])]

    return {
        'units': units,
        'pageOffset': 0,    # pymupdf 提取的页码即真实 PDF 页码，无需偏移
        'totalPages': total_pages,
        'method': 'fontsize',
        'bodyFont': body_font,
        'titleSizes': [round(r, 1) for r in cluster_reps][:5],
        'titleCount': len(title_lines)
    }


def parse_existing_toc(toc_list, total_pages):
    """忠实解析 PDF 自带书签：保留原始层级与页码，不做正则过滤。

    层级1→单元，层级2→栏目或课文，层级3→课文。页码即真实 PDF 页码，偏移=0。
    这样书签与正文一一对应，点击书签即到达正文。
    """
    units = []
    cur_unit = None

    for entry in toc_list:
        if len(entry) < 3:
            continue
        level, title, page = entry[0], entry[1].strip(), entry[2]
        if not title or page < 1:
            continue

        if level == 1:
            cur_unit = {'title': title, 'page': page, 'lessons': []}
            units.append(cur_unit)
        elif level == 2:
            if cur_unit is None:
                cur_unit = {'title': '未命名单元', 'page': page, 'lessons': []}
                units.append(cur_unit)
            is_group = any(kw in title for kw in GROUP_KEYWORDS)
            if is_group:
                cur_unit['lessons'].append({'title': title, 'type': 'group', 'page': page})
            else:
                cur_unit['lessons'].append({'title': title, 'type': 'lesson', 'startPage': page})
        else:  # level >= 3
            if cur_unit is None:
                cur_unit = {'title': '未命名单元', 'page': page, 'lessons': []}
                units.append(cur_unit)
            cur_unit['lessons'].append({'title': title, 'type': 'lesson', 'startPage': page})

    units = _compute_endpages(units, total_pages)
    units = [u for u in units if any(l['type'] == 'lesson' for l in u['lessons'])]

    return {'units': units, 'pageOffset': 0, 'totalPages': total_pages, 'method': 'bookmark'}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.endswith('.zip'):
            filename = os.path.basename(unquote(self.path))
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
            self.send_header('Content-Type', 'application/zip')
        super().end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")

    def do_POST(self):
        if self.path == '/api/extract-toc':
            self.handle_extract_toc()
        else:
            self.send_error(404)

    def handle_extract_toc(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_json({'error': 'No data received'})
            return

        body = self.rfile.read(content_length)

        try:
            result = extract_toc_with_fitz(body)
            print(f"[API] 提取完成: {len(result.get('units', []))} 个单元, 方法={result.get('method')}, 偏移={result.get('pageOffset')}")
            self.send_json(result)
        except Exception as e:
            print(f"[API] 提取失败: {e}")
            self.send_json({'error': str(e), 'units': [], 'pageOffset': 0})

    def send_json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    os.chdir(ROOT)
    server = http.server.HTTPServer(('', PORT), Handler)
    print(f"Serving {ROOT} on port {PORT}")
    print(f"API: POST /api/extract-toc (upload PDF bytes)")
    server.serve_forever()
