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

# 人教版初中语文目录正则与关键词（参考用户的 Python 书签程序）
UNIT_RE = re.compile(r'第[一二三四五六七八九十百零〇两0-9]+单元')
GROUP_KEYWORDS = ['写作', '综合性学习', '名著导读', '课外古诗词诵读', '课外古诗词',
                  '口语交际', '活动·探究', '活动探究', '任务', '汉语知识', '语法知识']
LESSON_NUM_RE = re.compile(r'^\d+\*?\s*[.．、]?\s*\S')
# 版权/编目页关键词
SKIP_KEYWORDS = ['版权所有', '著作权所有', 'ISBN', 'CIP', '图书在版编目', '出版发行']


def _is_unit_title(text):
    """严格判定单元标题：第X单元（X 为汉字或数字）。"""
    text = text.strip()
    if not UNIT_RE.search(text):
        return False
    # 单元标题很短（≤ 15 字），避免误把含单元词的长句识别为标题
    if len(text) > 15:
        return False
    return True


def _is_lesson_l2(text):
    """判定二级文章：编号开头（1 春 / 3* 雨的四季）或栏目关键词开头（写作/综合性学习/名著导读/课外古诗词诵读）"""
    text = text.strip()
    if LESSON_NUM_RE.match(text):
        return True
    for kw in GROUP_KEYWORDS:
        if text.startswith(kw):
            return True
    return False


def _is_running_header(text_pages_map, text, total_pages):
    """页眉/页脚判定：在多页重复出现的文本。"""
    pages = text_pages_map.get(text)
    if not pages:
        return False
    if len(pages) > 5 or len(pages) > max(3, total_pages * 0.1):
        return True
    return False


def _detect_skip_pages(page_lines):
    """检测需要跳过的页：目录页、版权页。封面靠"L3 必须有 L2 父"规则自动过滤。"""
    skip = set()
    for p, lines in page_lines.items():
        text_all = "\n".join(l['text'] for l in lines)
        # 版权/编目页
        if any(kw in text_all for kw in SKIP_KEYWORDS):
            skip.add(p)
            continue
        # 目录页：含"目录"标题字样，或同时出现多个单元 + 多个编号条目
        has_toc_title = any('目录' in l['text'] and len(l['text'].strip()) <= 4 and l['fontsize'] > 12 for l in lines)
        unit_count = len(UNIT_RE.findall(text_all))
        numbered_count = sum(1 for l in lines if LESSON_NUM_RE.match(l['text']))
        if has_toc_title or (unit_count >= 2 and numbered_count >= 3):
            skip.add(p)
    return skip


def _compute_endpages_v2(units, total_pages):
    """为所有 lesson/sublesson 计算 endPage。

    叶子按 unit→lesson→sublesson 顺序扁平排列，每个叶子的 endPage = 下一个叶子的 startPage - 1。
    含 children 的 lesson 的 endPage = 最后一个 child 的 endPage（覆盖它和所有子篇目的范围）。
    """
    leaves = []
    for u in units:
        for l in u['lessons']:
            if l['type'] == 'lesson':
                leaves.append(l)
                for sub in l.get('children', []):
                    leaves.append(sub)
    for i, leaf in enumerate(leaves):
        sp = leaf.get('startPage', 1)
        leaf['startPage'] = sp
        nxt = leaves[i + 1]['startPage'] if i + 1 < len(leaves) else total_pages + 1
        leaf['endPage'] = max(sp, nxt - 1)
        if leaf['endPage'] > total_pages:
            leaf['endPage'] = total_pages
    # 含 children 的 lesson，endPage 取末位 child 的 endPage
    for u in units:
        for l in u['lessons']:
            if l['type'] == 'lesson' and l.get('children'):
                last = l['children'][-1]
                l['endPage'] = last.get('endPage', l.get('endPage', total_pages))
    return units


def extract_toc_with_fitz(pdf_bytes):
    """用 pymupdf 提取三级目录（参考用户 Python 书签程序的层级规则）。

    层级规则：
      L1（单元）= 严格匹配"第X单元"的标题
      L2（文章）= 编号开头（1 春 / 3* 雨的四季）或栏目关键词开头
                  （写作 / 综合性学习 / 名著导读 / 课外古诗词诵读）
      L3（子篇目）= L2 下面的子标题（金色花 / 观沧海 / 咏雪 等）
    跳过：封面（靠 L3 必须有 L2 父规则）、版权页、目录页、页眉页脚。
    页码即真实 PDF 页码，pageOffset=0，点击书签直达正文。
    """
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)

    # 1. 优先使用 PDF 自带书签（最准确，已含层级信息）
    existing_toc = doc.get_toc()
    if existing_toc:
        result = parse_existing_toc(existing_toc, total_pages)
        if result['units']:
            doc.close()
            return result

    # 2. 字号扫描提取
    page_lines = {}      # page -> [lines]
    text_pages = {}      # text -> set of pages（页眉页脚检测）
    font_count = {}

    for page_idx in range(total_pages):
        page = doc[page_idx]
        blocks = page.get_text("dict")["blocks"]
        lines = []
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
                lines.append({
                    'page': page_idx + 1,
                    'text': line_text,
                    'fontsize': line_max_font,
                    'y': round(line_y, 1)
                })
                text_pages.setdefault(line_text, set()).add(page_idx + 1)
                fs_key = str(line_max_font)
                font_count[fs_key] = font_count.get(fs_key, 0) + 1
        page_lines[page_idx + 1] = lines

    doc.close()

    if not font_count:
        return {'units': [], 'pageOffset': 0, 'totalPages': total_pages, 'method': 'none'}

    # 跳过页检测
    skip_pages = _detect_skip_pages(page_lines)

    # 正文字号 = 出现次数最多的字号
    body_font = float(max(font_count.items(), key=lambda x: x[1])[0])

    # 标题行 = 字号严格大于正文，不在跳过页，不是页眉页脚
    title_lines = [
        l for p, lines in page_lines.items()
        for l in lines
        if l['fontsize'] > body_font + 0.5
        and p not in skip_pages
        and not _is_running_header(text_pages, l['text'], total_pages)
    ]
    # 按页码、y 坐标排序（先按页，再按 y 从上到下，即降序）
    title_lines.sort(key=lambda l: (l['page'], -l['y']))

    if not title_lines:
        return {'units': [], 'pageOffset': 0, 'totalPages': total_pages,
                'method': 'none', 'bodyFont': body_font}

    # 按规则构建三级目录
    units = []
    cur_unit = None
    cur_l2 = None
    for line in title_lines:
        text = line['text'].strip()
        page = line['page']
        if _is_unit_title(text):
            cur_unit = {'title': text, 'page': page, 'lessons': []}
            units.append(cur_unit)
            cur_l2 = None
        elif _is_lesson_l2(text):
            if cur_unit is None:
                cur_unit = {'title': '未命名单元', 'page': page, 'lessons': []}
                units.append(cur_unit)
            is_group = any(text.startswith(kw) for kw in GROUP_KEYWORDS)
            if is_group:
                cur_l2 = None
                cur_unit['lessons'].append({'title': text, 'type': 'group', 'page': page})
            else:
                cur_l2 = {'title': text, 'type': 'lesson', 'startPage': page, 'children': []}
                cur_unit['lessons'].append(cur_l2)
        else:
            # L3 子篇目：必须有 L2 父，否则丢弃（封面/版权页的杂项大字）
            if cur_l2 is not None:
                cur_l2['children'].append({'title': text, 'type': 'sublesson', 'startPage': page})

    _compute_endpages_v2(units, total_pages)
    units = [u for u in units if any(l['type'] == 'lesson' for l in u['lessons'])]

    return {
        'units': units,
        'pageOffset': 0,    # pymupdf 页码即真实 PDF 页码，无需偏移
        'totalPages': total_pages,
        'method': 'fontsize',
        'bodyFont': body_font,
        'titleCount': len(title_lines)
    }


def parse_existing_toc(toc_list, total_pages):
    """解析 PDF 自带书签为三级结构（与字号扫描结果同构）。

    层级 1 → 单元；层级 2 → lesson（或栏目 group）；层级 3 → sublesson（挂在最近 L2 下）。
    页码即真实 PDF 页码，偏移 = 0。
    """
    units = []
    cur_unit = None
    cur_l2 = None

    for entry in toc_list:
        if len(entry) < 3:
            continue
        level, title, page = entry[0], entry[1].strip(), entry[2]
        if not title or page < 1:
            continue

        if level == 1:
            cur_unit = {'title': title, 'page': page, 'lessons': []}
            units.append(cur_unit)
            cur_l2 = None
        elif level == 2:
            if cur_unit is None:
                cur_unit = {'title': '未命名单元', 'page': page, 'lessons': []}
                units.append(cur_unit)
            is_group = any(kw in title for kw in GROUP_KEYWORDS)
            if is_group:
                cur_l2 = None
                cur_unit['lessons'].append({'title': title, 'type': 'group', 'page': page})
            else:
                cur_l2 = {'title': title, 'type': 'lesson', 'startPage': page, 'children': []}
                cur_unit['lessons'].append(cur_l2)
        else:  # level >= 3
            if cur_l2 is not None:
                cur_l2['children'].append({'title': title, 'type': 'sublesson', 'startPage': page})
            elif cur_unit is not None:
                # 无 L2 父 → 当作独立 lesson
                cur_unit['lessons'].append({'title': title, 'type': 'lesson', 'startPage': page, 'children': []})

    _compute_endpages_v2(units, total_pages)
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
