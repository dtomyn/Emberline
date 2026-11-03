"""Render the Emberline explainer from the live app, one exact frame at a time.

The scenes and narration are in film/scenes.js (see film/storyboard.md); every number comes from the loaded
record, so re-run this after a data refresh. Uses the IRISIdeas Python environment (playwright, imageio-ffmpeg,
kokoro-onnx, soundfile, numpy) and the installed Microsoft Edge. Run it through `npm run film`.

  render.py                     The 1080p film, captions, script, YouTube text and storyboard. Roughly an hour.
  render.py --preview           A quick 720p, 15 fps cut to check timing and sound.
  render.py --stills 5,40,90    Save frames at these seconds as JPEGs, no video.
  render.py --until 30          Stop after 30 seconds of film (with --preview, for quick checks).

Options: --scale sets the capture's pixel ratio (the layout is always 1600x900; 1.5 captures 2400x1350, which
keeps the zoom-ins sharp at 1080p). --url puts an address on the end card and in the YouTube text.
Everything is written to data/film/ (gitignored). The narration is made by scripts/kokoro-voice.py into
data/film/voice and only remade for lines whose text changed.
"""
import argparse
import base64
import html
import importlib.util
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import time
import urllib.request

import imageio_ffmpeg
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import sound  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILM = ROOT / "film"
OUT = ROOT / "data" / "film"
VOICE_DIR = OUT / "voice"
NAME = "emberline-explainer"
LAYOUT = (1600, 900)
MODEL_DIR = pathlib.Path(os.environ.get("KOKORO_DIR", r"C:\DevSource\IRISIdeas\.venv\kokoro"))
SETTLE = """async () => {
  const m = emberline.map;
  for (let i = 0; i < 200 && !m.areTilesLoaded(); i++) { __clock.redraw(); await __clock.sleep(25); }
  __clock.redraw();
}"""


def log(*args):
    print(*args, flush=True)


def start_server():
    """Emberline's own server on a free port, so the film never depends on one already running."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(["node", "server/index.mjs", str(port)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sources", timeout=1)
            return proc, port
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise SystemExit("The Emberline server did not start: " + proc.stderr.read().decode()[-500:])


def voice(lines):
    """Kokoro clips for every line, through the documentary's own voice script (same voice, same fixes)."""
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("kokoro_voice", ROOT / "scripts" / "kokoro-voice.py")
    kv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kv)
    path = VOICE_DIR / "lines.json"
    path.write_text(json.dumps(lines, indent=1, ensure_ascii=False), encoding="utf-8")
    kv.main(str(path), str(VOICE_DIR), str(MODEL_DIR))
    return json.loads((VOICE_DIR / "manifest.json").read_text(encoding="utf-8"))["clips"]


def open_page(playwright, port, scale, url):
    browser = playwright.chromium.launch(channel="msedge", headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": LAYOUT[0], "height": LAYOUT[1]}, device_scale_factor=scale)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # The film's own modules are served from film/ (the app server only serves the app)
    page.route(re.compile(rf"^http://127\.0\.0\.1:{port}/film/[\w-]+\.js$"),
               lambda route: route.fulfill(path=str(FILM / route.request.url.rsplit("/", 1)[1]), content_type="text/javascript"))
    page.add_init_script(path=str(FILM / "clock.js"))
    page.goto(f"http://127.0.0.1:{port}/")
    page.add_script_tag(url="/film/director.js", type="module")
    page.wait_for_function("window.Film", polling=100, timeout=30000)
    started = time.time()
    while not page.evaluate("Film.ready()"):
        page.evaluate("__clock.advance(33)")
        time.sleep(0.03)
        if time.time() - started > 120:
            raise SystemExit("The app did not finish loading (data, spread list, live picture) in two minutes.")
    lines = page.evaluate("o => Film.script(o)", {"url": url or ""})
    clips = voice(lines)
    page.evaluate("c => Film.start(c)", clips)
    if errors:
        raise SystemExit(f"The page reported errors while loading: {errors}")
    return browser, page, errors, clips


def film_frames(page, fps, on_frame):
    """Step the film one frame at a time: mouse, wait for the map, then hand the crop to on_frame."""
    ms = 1000 / fps
    mouse = None
    waits = 0
    while True:
        r = page.evaluate("ms => Film.step(ms)", ms)
        if r.get("wait"):
            waits += 1
            if waits > 1200:
                raise SystemExit(f"The film waited a minute for something to load in scene {r.get('scene')}.")
            time.sleep(0.05)
            continue
        waits = 0
        x, y = r["mouse"]
        if mouse != (round(x, 1), round(y, 1)):
            page.mouse.move(x, y)
            mouse = (round(x, 1), round(y, 1))
        for event in r["events"]:
            page.mouse.down() if event == "down" else page.mouse.up()
        page.evaluate(SETTLE)
        if not on_frame(r):
            return r
        if r["done"]:
            return r


def capture(page, crop, quality):
    return page.screenshot(type="jpeg", quality=quality, clip=crop, animations="allow", caret="initial")


def stamp(s, sep=","):
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}{sep}{ms % 1000:03}"


def clock_label(s):
    return f"{int(s) // 60}:{int(s) % 60:02}"


def write_captions(timeline, clips):
    """Sentence by sentence, from the voice script's own timings; long sentences break at commas."""
    out, n = [], 0
    for v in timeline["voiced"]:
        clip = clips[v["text"]]
        from_marks = zip(re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", v["text"]), clip["marks"])
        for sentence, mark in from_marks:
            parts, cur = [], ""
            for piece in re.split(r"(?<=,)\s+", sentence):
                if cur and len(cur) + len(piece) > 80:
                    parts.append(cur)
                    cur = piece
                else:
                    cur = f"{cur} {piece}".strip()
            parts.append(cur)
            at, span = v["at"] + mark["start"], mark["end"] - mark["start"]
            total = sum(map(len, parts))
            for p in parts:
                end = at + span * len(p) / total
                n += 1
                out += [str(n), f"{stamp(at)} --> {stamp(end)}", p, ""]
                at = end
    (OUT / f"{NAME}.srt").write_text("\n".join(out), encoding="utf-8")


def write_script(timeline):
    parts = [f"# Emberline explainer: narration as rendered\n\n{clock_label(timeline['total'])} in all. Written by `film/render.py` from "
             "`film/scenes.js`; every figure comes from the loaded record.\n"]
    for sc in timeline["scenes"]:
        parts.append(f"\n## {clock_label(sc['at'])} {sc['title']}\n\n{sc['shows']}\n")
        parts += [f"\n`{clock_label(v['at'])}` {v['text']}\n" for v in timeline["voiced"] if v["scene"] == sc["id"]]
    (OUT / "script.md").write_text("".join(parts), encoding="utf-8")


def write_youtube(timeline, url):
    f = timeline["facts"]
    chapters = "\n".join(f"{clock_label(sc['at'])} {sc['title']}" for sc in timeline["scenes"] if sc["id"] != "end")
    (OUT / "youtube.txt").write_text(f"""TITLE
Every wildfire in Saskatchewan since {f['firstYear']}, replayed | Emberline

DESCRIPTION
{f['fires']:,} recorded wildfires and {f['hectares']:,} hectares burned, {f['firstYear']} to {f['lastYear']}, replayed on the day each one started. Then a true spread replay rebuilt from satellite detections, the record's biggest lightning outbreak, the whole record in 3D, a live view built on SPSA's own GIS services, and every source behind it.

Try it yourself: {url or '[add the link]'}

Everything in this video is the real application, filmed frame by frame. Every figure is computed from the data at render time. The narration is a synthetic voice (Kokoro, generated locally) and the music and sound effects are synthesized.

{chapters}

Sources: Canadian National Fire Database (NRCan), National Burned Area Composite (NRCan), CWFIS satellite hotspots, Saskatchewan Public Safety Agency ArcGIS services, ECCC MSC GeoMet lightning. Burn circles have the same area as the reported fire, not its perimeter; the spread front is interpolated between real detections.
Independent visualization. Not a Government of Saskatchewan or SPSA product.

TAGS
Saskatchewan, wildfire, forest fire, SPSA, data visualization, open data, maps, WebGL, deck.gl, MapLibre
""", encoding="utf-8")


def write_storyboard(timeline, boards):
    css = """:root{--bg:#f6f4f1;--panel:#fff;--ink:#1b1714;--muted:#6b6058;--line:#e4ddd5;--accent:#c2500f}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--panel:#161210;--ink:#f1e9e1;--muted:#a8998c;--line:#2c2420;--accent:#ff8a3d}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Segoe UI",system-ui,sans-serif}main{max-width:1120px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:30px;margin:0 0 6px}.lede{color:var(--muted);max-width:72ch}section{margin-top:32px;border-top:1px solid var(--line);padding-top:16px;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:18px}
@media (max-width:760px){section{grid-template-columns:1fr}}h2{font-size:20px;margin:0 0 4px}h2 time{color:var(--accent);margin-right:10px;font-variant-numeric:tabular-nums}
img{width:100%;border-radius:6px;border:1px solid var(--line);display:block}.said p{margin:0 0 8px;padding-left:12px;border-left:3px solid var(--accent)}.said time{color:var(--muted);font-size:13px;margin-right:6px}.muted{color:var(--muted)}"""
    parts = []
    for sc in timeline["scenes"]:
        img = boards.get(sc["id"])
        said = "".join(f"<p><time>{clock_label(v['at'])}</time>{html.escape(v['text'])}</p>" for v in timeline["voiced"] if v["scene"] == sc["id"])
        parts.append(f"<section><div>{f'<img alt=\"{html.escape(sc['title'])}\" src=\"data:image/jpeg;base64,{img}\">' if img else ''}</div>"
                     f"<div><h2><time>{clock_label(sc['at'])}</time>{html.escape(sc['title'])}</h2><p class=\"muted\">{html.escape(sc['shows'])}</p><div class=\"said\">{said}</div></div></section>")
    (OUT / "storyboard.html").write_text(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>Emberline Storyboard</title><style>{css}</style></head><body><main><h1>Emberline: explainer storyboard</h1>"
        f"<p class=\"lede\">{clock_label(timeline['total'])}. Every frame here is a real frame of the render, and the narration comes from "
        "<code>film/scenes.js</code>, computed from the loaded record. The plan behind it is <code>film/storyboard.md</code>.</p>"
        + "".join(parts) + "</main></body></html>", encoding="utf-8")


def render(args):
    preview = args.preview
    fps = 15 if preview else args.fps
    scale = args.scale if args.scale else (0.8 if preview else 1.5)
    size = "1280:720" if preview else "1920:1080"
    server, port = start_server()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    suffix = "-preview" if preview else ""
    silent = OUT / f"{NAME}{suffix}-silent.mp4"
    try:
        with sync_playwright() as playwright:
            browser, page, errors, clips = open_page(playwright, port, scale, args.url)
            stills = sorted(float(s) for s in args.stills.split(",")) if args.stills else None
            encoder = None if stills else subprocess.Popen(
                [ffmpeg, "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-r", str(fps), "-i", "-",
                 # Screenshot JPEGs are full-range BT.601; the crop changes size as the camera zooms, so scale every frame
                 "-vf", f"scale={size}:flags=lanczos:in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv,format=yuv420p",
                 "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
                 "-c:v", "libx264", "-preset", "veryfast" if preview else "slow", "-crf", "24" if preview else "17",
                 "-r", str(fps), "-movflags", "+faststart", str(silent)], stdin=subprocess.PIPE)
            boards, seen, started, count = {}, {}, time.time(), [0]

            def on_frame(r):
                count[0] += 1
                t = r["t"]
                if args.until and t > args.until:
                    return False
                if stills is not None:
                    if not stills:
                        return False
                    if t >= stills[0]:
                        path = OUT / f"still-{stills.pop(0):06.1f}.jpg"
                        path.write_bytes(capture(page, r["crop"], 90))
                        log("still", round(t, 2), r["scene"], path)
                    return True
                shot = capture(page, r["crop"], 80 if preview else 92)
                encoder.stdin.write(shot)
                scene = r["scene"]
                seen.setdefault(scene, t)
                if scene not in boards and t - seen[scene] >= 3.5:
                    boards[scene] = base64.b64encode(page.screenshot(type="jpeg", quality=70, scale="css")).decode()
                if count[0] % (fps * 10) == 0:
                    log(f"{t:6.1f}s of film, scene {scene}, {time.time() - started:.0f}s elapsed")
                return True

            film_frames(page, fps, on_frame)
            timeline = page.evaluate("Film.timeline()")
            browser.close()
            if errors:
                log("page errors:", errors)
            if stills is not None:
                return
            encoder.stdin.close()
            encoder.wait()
            log(f"{count[0]} frames, {timeline['total']:.1f}s of film in {time.time() - started:.0f}s")
    finally:
        server.kill()
    if args.until:
        timeline["total"] = min(timeline["total"], args.until)
    (OUT / "timeline.json").write_text(json.dumps(timeline, indent=1), encoding="utf-8")
    wav = OUT / f"{NAME}{suffix}.wav"
    sound.mix(timeline, VOICE_DIR, clips, wav, fps)
    final = OUT / f"{NAME}{suffix}.mp4"
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(silent), "-i", str(wav),
                    "-af", "aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11",
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", str(final)], check=True)
    silent.unlink()
    write_captions(timeline, clips)
    write_script(timeline)
    write_youtube(timeline, args.url)
    write_storyboard(timeline, boards)
    log("wrote", final, f"{final.stat().st_size / 1e6:.1f} MB, with", f"{NAME}.srt, script.md, youtube.txt, storyboard.html in", OUT)
    if errors:
        raise SystemExit("The page reported errors during the render (listed above).")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--preview", action="store_true", help="quick 720p, 15 fps")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--scale", type=float, help="capture pixel ratio (default 1.5, preview 0.8)")
    parser.add_argument("--stills", help="comma-separated seconds to save as JPEGs")
    parser.add_argument("--until", type=float, help="stop after this many seconds of film")
    parser.add_argument("--url", help="address for the end card and the YouTube description")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    render(args)


if __name__ == "__main__":
    main()
