"""Render the Emberline social images (LinkedIn cover, Viva Engage banner) from the live app.

Run it through `npm run make:social`, which computes the figures from the database (social/figures.js,
CNFDB only, the continuous record) and passes them here as JSON. This script:

  1. starts its own server and opens the app in headless Microsoft Edge with the UI hidden,
  2. shows the continuous record as golden-hour 3D hex columns and captures a clean frame at each card's size,
  3. loads social/cover.html and social/banner.html over those frames, fills every [data-fig] and screenshots them.

Usage: render.py <figures.json> <out dir>. Uses the IRISIdeas Python environment (playwright).
Output (gitignored): <out dir>/emberline-linkedin-cover.png, emberline-viva-engage-banner.png, frames/.
"""
import json
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOCIAL = ROOT / "social"

# name, template, viewport, camera over the hex columns
CARDS = [
    ("emberline-linkedin-cover", "cover.html", (1920, 1080), {"center": [-112.2, 55.9], "zoom": 5.55, "pitch": 60, "bearing": -24}),
    ("emberline-viva-engage-banner", "banner.html", (2400, 900), {"center": [-113.0, 53.4], "zoom": 5.35, "pitch": 58, "bearing": -55}),
]
HIDE_UI = ("body > *:not(#map):not(.vignette){opacity:0 !important; pointer-events:none}"
           " #intro{display:none !important} .maplibregl-ctrl{display:none !important}")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_server(port):
    for _ in range(150):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sources", timeout=1)
            return
        except Exception:
            time.sleep(0.2)
    raise SystemExit("The Emberline server did not start.")


def wait_until(page, expr, timeout, what):
    """Poll an expression with page.evaluate (the app's CSP blocks Playwright's eval-based wait_for_function)."""
    end = time.time() + timeout
    while not page.evaluate(expr):
        if time.time() > end:
            raise SystemExit(f"Timed out waiting for {what}.")
        time.sleep(0.25)


def capture_frame(browser, port, figures, size, camera, path):
    """A clean frame of the app: the continuous record as 3D hex columns at golden hour, no UI."""
    page = browser.new_page(viewport={"width": size[0], "height": size[1]}, device_scale_factor=1)
    page.goto(f"http://127.0.0.1:{port}/")
    wait_until(page, "!!(window.emberline && emberline.state.all && emberline.state.all.length > 0)", 90, "the app to load")
    page.add_style_tag(content=HIDE_UI)
    source = page.evaluate("emberline.state.source")
    if source != figures["source"]:
        raise SystemExit(f"The app loaded '{source}', but the figures are for '{figures['source']}'.")
    page.evaluate("""([from, to]) => {
        const { app, scene } = emberline;
        document.querySelector('#intro')?.classList.add('gone');
        app.pause();
        app.set({ mode: 'explore', yrFrom: from, yrTo: to, viz: 'hex' });
        scene.setSky('golden');
    }""", [figures["firstYear"], figures["lastYear"]])
    time.sleep(1.5)
    page.evaluate("c => emberline.map.jumpTo(c)", camera)
    # Let the columns rise and the basemap tiles land (the animated map never reports idle, so wait a fixed time)
    time.sleep(6)
    page.screenshot(path=str(path))
    page.close()


def compose(browser, template, size, frame, figures, path):
    page = browser.new_page(viewport={"width": size[0], "height": size[1]}, device_scale_factor=1)
    page.goto((SOCIAL / template).as_uri())
    page.evaluate("""([bg, text]) => {
        document.querySelector('.bg').style.backgroundImage = `url("${bg}")`;
        for (const el of document.querySelectorAll('[data-fig]')) {
            const v = text[el.dataset.fig];
            if (v == null) throw new Error(`No figure '${el.dataset.fig}'`);
            el.textContent = v;
        }
    }""", [frame.as_uri(), figures["text"]])
    page.evaluate("document.fonts.ready")
    time.sleep(1)
    page.screenshot(path=str(path))
    page.close()


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    figures = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = pathlib.Path(sys.argv[2])
    frames = out / "frames"
    frames.mkdir(parents=True, exist_ok=True)

    port = free_port()
    server = subprocess.Popen(["node", "server/index.mjs", str(port)], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for_server(port)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=True,
                                        args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
            for name, template, size, camera in CARDS:
                frame = frames / f"{name}-frame.png"
                print(f"Capturing {name} background ({size[0]}x{size[1]})...", flush=True)
                capture_frame(browser, port, figures, size, camera, frame)
                compose(browser, template, size, frame, figures, out / f"{name}.png")
                print(f"  wrote {out / (name + '.png')}", flush=True)
            browser.close()
    finally:
        server.terminate()


if __name__ == "__main__":
    main()
