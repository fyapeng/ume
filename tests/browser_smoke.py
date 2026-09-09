"""Browser smoke tests; no accounts, secrets, or remote progress writes are used."""
import argparse
import json
import os
from pathlib import Path
import shutil
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from html.parser import HTMLParser
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'test-results'
KEY = 'ume-reading-progress-v1'
RELEASE = 'rocket-loader-fix-1'


class PageScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.release = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'script':
            self.scripts.append(attrs)
        elif tag == 'meta' and attrs.get('name') == 'ume-release':
            self.release = attrs.get('content')


def wait_for_release(url):
    deadline = time.monotonic() + 180
    last = 'not checked'
    while time.monotonic() < deadline:
        try:
            request = Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'UME-browser-check/1.0'})
            with urlopen(request, timeout=20) as response:
                parser = PageScripts()
                parser.feed(response.read(500000).decode('utf-8'))
            app_scripts = [s for s in parser.scripts if any(name in s.get('src', '') for name in ['readings.js', 'app.js'])]
            last = json.dumps({'release': parser.release, 'scripts': app_scripts})
            if parser.release == RELEASE:
                assert len(app_scripts) == 2, last
                for script in app_scripts:
                    assert script.get('data-cfasync') == 'false', last
                    assert script.get('type', '') in ('', 'text/javascript', 'application/javascript'), last
                print('LIVE_DELIVERY', last, flush=True)
                return
        except Exception as error:
            last = str(error)
        time.sleep(5)
    raise AssertionError('Published fix not available after 180 seconds: ' + last)


def run_checks(browser, url, label, block_rocket=False):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    if block_rocket:
        context.route('**/cdn-cgi/scripts/**/rocket-loader.min.js*', lambda route: route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='domcontentloaded', timeout=60000)
    expect(page.locator('.paper')).to_have_count(59)
    expect(page.locator('.week')).to_have_count(28)
    expect(page.locator('#week-select option')).to_have_count(29)
    expect(page.locator('#completed-count')).to_have_text('0')
    page.screenshot(path=str(ARTIFACTS / f'{label}-desktop.png'))

    for code in ['M04', 'M01', 'C02']:
        page.locator('#check-' + code).check()
    expect(page.locator('#completed-count')).to_have_text('3')
    expect(page.locator('#weeks-count')).to_have_text('完成 1 / 28 周')
    page.locator('[data-filter="read"]').click()
    expect(page.locator('.paper:visible')).to_have_count(3)
    page.locator('[data-filter="unread"]').click()
    expect(page.locator('.paper:visible')).to_have_count(56)
    page.locator('[data-filter="all"]').click()
    page.locator('#week-select').select_option('2')
    expect(page.locator('.paper:visible')).to_have_count(2)
    page.locator('#week-select').select_option('all')
    page.locator('#search').fill('Spence')
    expect(page.locator('.paper:visible')).to_have_count(1)
    expect(page.locator('#paper-M19')).to_be_visible()
    page.locator('#search').fill('no-matching-reading-12345')
    expect(page.locator('#empty')).to_be_visible()
    page.locator('#clear-filters').click()
    expect(page.locator('.paper:visible')).to_have_count(59)
    page.locator('#continue').click()
    expect(page.locator('#check-M02')).to_be_focused()

    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#completed-count')).to_have_text('3')
    expect(page.locator('#check-M04')).to_be_checked()
    with page.expect_download() as download_event:
        page.locator('#export').click()
    backup = ARTIFACTS / f'{label}-progress.json'
    download_event.value.save_as(str(backup))
    saved = json.loads(backup.read_text())
    assert set(saved['completed']) == {'M04', 'M01', 'C02'}

    page.locator('#check-M04').uncheck()
    expect(page.locator('#completed-count')).to_have_text('2')
    page.once('dialog', lambda dialog: dialog.accept())
    page.locator('#import-file').set_input_files(str(backup))
    expect(page.locator('#completed-count')).to_have_text('3')

    # A clean second tab receives updates through the same localStorage key.
    second = context.new_page()
    second.goto(url, wait_until='domcontentloaded', timeout=60000)
    expect(second.locator('#completed-count')).to_have_text('3')
    page.locator('#check-M02').check()
    expect(second.locator('#completed-count')).to_have_text('4')
    second.close()

    # Check phone layout in a separate, empty browser context.
    phone_context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=1)
    if block_rocket:
        phone_context.route('**/cdn-cgi/scripts/**/rocket-loader.min.js*', lambda route: route.abort())
    phone = phone_context.new_page()
    phone.goto(url, wait_until='domcontentloaded', timeout=60000)
    expect(phone.locator('.paper')).to_have_count(59)
    assert phone.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow'
    phone.screenshot(path=str(ARTIFACTS / f'{label}-mobile.png'))
    phone.locator('#check-M04').check()
    phone.locator('[data-filter="read"]').click()
    expect(phone.locator('.paper:visible')).to_have_count(1)
    phone_context.close()
    context.close()
    assert not errors, 'Page JavaScript errors: ' + repr(errors)
    print(json.dumps({'test': label, 'passed': True, 'papers': 59, 'weeks': 28, 'checks': ['read-unread filters', 'week filter', 'search', 'continue reading', 'reload persistence', 'export', 'import', 'cross-tab sync', 'mobile layout'], 'rocket_loader_blocked': block_rocket}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true')
    args = parser.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            executable = shutil.which('google-chrome') or shutil.which('chromium')
            browser = playwright.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'])
            run_checks(browser, f'http://127.0.0.1:{server.server_port}/', 'local')
            if args.live:
                url = 'https://fyapeng.com/ume/?check=rocket-loader-fix-1'
                wait_for_release(url)
                run_checks(browser, url, 'live')
                run_checks(browser, url, 'live-without-rocket-loader', block_rocket=True)
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
