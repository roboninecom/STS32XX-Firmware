"""Validate translated Markdown structure and immutable technical content (stdlib only)."""
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/i18n'
LINK = re.compile(r'\]\(([^\s)]+)\)')
NAV = re.compile(r'\n?<!-- documentation-languages -->.*?<!-- /documentation-languages -->\n?', re.S)


def source_body(path):
    return NAV.sub('', path.read_text(encoding='utf-8')).strip() + '\n'


def body(text):
    match = re.search(r'<!-- translated-content -->\n(.*?)\n<!-- /translated-content -->', text, re.S)
    if not match:
        raise ValueError('missing translated-content boundaries')
    return re.sub(r'<a id="[^"]+"></a>\n', '', match[1])


def shape(text):
    return {
        'headings': len(re.findall(r'^#{1,6} ', text, re.M)),
        'table_rows': len(re.findall(r'^\|', text, re.M)),
        'steps': len(re.findall(r'^\s*\d+\. ', text, re.M)),
        'links': len(LINK.findall(text)),
        'images': len(re.findall(r'!\[', text)),
        'bold_delimiters': text.count('**'),
        'link_openers': text.count('['),
    }


def code(text):
    return re.findall(r'^```[^\n]*\n.*?^```[ \t]*$', text, re.M | re.S)


def numbers(text):
    text = LINK.sub('](LINK)', text)
    text = re.sub(r'<[^>]+>', '', text)
    return Counter(re.findall(r'[−±+-]?(?:0x[0-9A-Fa-f]+|\d+(?:[.,]\d+)*)(?:[–−-]\d+(?:[.,]\d+)*)?', text))


def inline_code(text):
    for block in code(text):
        text = text.replace(block, '')
    return Counter(re.findall(r'`[^`\n]+`', text))


def anchors(text):
    found = set(re.findall(r'<a id="([^"]+)"></a>', text))
    counts = Counter()
    in_code = False
    for line in text.splitlines():
        if line.startswith('```'):
            in_code = not in_code
        if in_code:
            continue
        match = re.match(r'^#{1,6} (.*)', line)
        if match:
            label = re.sub(r'<[^>]+>', '', match[1]).lower().strip()
            anchor = re.sub(r'[^\w\- ]', '', label).replace(' ', '-')
            occurrence = counts[anchor]
            counts[anchor] += 1
            found.add(anchor + (f'-{occurrence}' if occurrence else ''))
    return found


def check():
    manifest = json.loads((BASE / 'manifest.json').read_text(encoding='utf-8'))
    errors = []
    documents = manifest['documents']
    original_files = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*.md')
                      if not p.is_relative_to(BASE) and not any(x in p.parts for x in ['.git', 'node_modules'])
                      and p.relative_to(ROOT).as_posix() != 'docs/translations.md'}
    if set(documents) != original_files:
        errors.append(f'Incomplete source coverage: {set(documents) ^ original_files}')
    text_cache = {}
    for filename, record in documents.items():
        source = source_body(ROOT / filename)
        sha = hashlib.sha256(source.encode()).hexdigest()
        if record['source_sha256'] != sha:
            errors.append(f'Source hash changed: {filename}')
        if set(record['translations']) != set(manifest['locales']):
            errors.append(f'Missing languages: {filename}')
        for locale, entry in record['translations'].items():
            label = f'{locale}: {filename}'
            path = ROOT / entry['path']
            if not path.is_file():
                errors.append(f'Missing file: {label}')
                continue
            text = path.read_text(encoding='utf-8')
            try:
                translated = body(text)
            except ValueError as e:
                errors.append(f'{label}: {e}')
                continue
            if entry['source_sha256'] != sha:
                errors.append(f'Outdated translation: {label}')
            for name, extract in [('structure', shape), ('code blocks', code), ('inline code', inline_code)]:
                if extract(source) != extract(translated):
                    errors.append(f'Changed {name}: {label}')
            # A written quantity can become digits ("two bytes" -> "2 バイト").
            # Preserve every explicit source value, as in SO-ARM102's checker.
            if numbers(source) - numbers(translated):
                errors.append(f'Missing or altered numeric values: {label}')
            repeated = [m for m in re.finditer(r'(.{2,25})\1{4,}', translated)
                        if re.search(r'[^\W_]', m[1]) and m[0] not in source]
            if repeated:
                errors.append(f'Repeated generated text: {label}')
            if re.search(r'[⟦⟧⟪⟫]', translated):
                errors.append(f'Unresolved translation marker: {label}')
            external = lambda s: Counter(h for h in LINK.findall(s) if urlsplit(h).scheme)
            if external(source) != external(translated):
                errors.append(f'Changed external links: {label}')
            destinations = set()
            for href in LINK.findall(text):
                url = urlsplit(href)
                if url.scheme or url.netloc:
                    continue
                target = (path.parent / unquote(url.path)).resolve() if url.path else path.resolve()
                destinations.add(target)
                if not target.is_relative_to(ROOT) or not target.exists():
                    errors.append(f'Broken link: {label}: {href}')
                elif url.fragment and target.suffix == '.md':
                    if target not in text_cache:
                        text_cache[target] = anchors(target.read_text(encoding='utf-8'))
                    if unquote(url.fragment) not in text_cache[target]:
                        errors.append(f'Broken anchor: {label}: {href}')
            expected = {(ROOT / x['path']).resolve() for x in record['translations'].values()}
            if not expected.issubset(destinations):
                errors.append(f'Incomplete language navigation: {label}')
    return errors, len(documents) * len(manifest['locales'])


if __name__ == '__main__':
    errors, count = check()
    if errors:
        print('\n'.join(errors))
        sys.exit(1)
    print(f'OK: {count} documents; coverage, source hashes, structure, exact code, retained numeric values, links and anchors checked.')
    print('Structural checks do not certify linguistic accuracy or native-speaker review.')
