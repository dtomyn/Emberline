"""
Kokoro narration for Emberline, in the same voice as C:\\DevSource\\IRISIdeas (scripts/render_explainer.py):
kokoro-onnx v1.0, voice af_heart, speed 0.97, 24 kHz, en-us phonemes with the same sound fixes.

  python kokoro-voice.py <lines.json> <out_dir> <model_dir>

lines.json is written by make-voice.mjs: [{ "id", "text", "sentences": [...] }]. Each line becomes one
OGG clip in out_dir, made sentence by sentence so the manifest can record when each sentence starts and
ends (captions and cues use those times). A clip is remade only when its text or the voice settings change.
Run it through `npm run make:voice`, which finds the IRISIdeas Python and model files.
"""
import hashlib
import json
import pathlib
import re
import sys
import time

import numpy
import soundfile
from kokoro_onnx import Kokoro

# Keep these identical to IRISIdeas render_explainer.py so both projects speak with one voice.
VOICE, VOICE_SPEED, VOICE_RATE = "af_heart", 0.97, 24000
# The voice reads these local names wrongly from their spelling, so they are given as sounds.
# The first two are IRISIdeas' own fixes; the rest are northern Saskatchewan names.
SOUNDS = {
    "sˈæskɐtʃˌuːən": "sæskˈætʃəwən",
    "ɹᵻdʒˈiːnə": "ɹᵻdʒˈaɪnə",
    "lˌæ ɹˈɔndʒ": "lə ɹˈɑːnʒ",
    "ˈaɪlˌɑːlækɹˈɔs": "ˈiːl ɐ lɐ kɹˈɔs",
    # The project's own name: "EMber-line", as in fire embers (the phonemizer stresses "BER")
    "ɛmbˈɜːlaɪn": "ˈɛmbɚlˌaɪn",
}
GAP = 0.32  # seconds of silence between sentences

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def two_digits(n):
    if n < 20:
        return ONES[n]
    return TENS[n // 10] + ("" if n % 10 == 0 else "-" + ONES[n % 10])


def year_words(y):
    """1981 → nineteen eighty-one, 2005 → two thousand five, 2015 → twenty fifteen. The phonemizer
    otherwise reads a year as a number ("nineteen hundred eighty one")."""
    if 2000 <= y <= 2009:
        return "two thousand" + ("" if y == 2000 else " " + ONES[y - 2000])
    hi, lo = divmod(y, 100)
    return two_digits(hi) + (" hundred" if lo == 0 else " oh " + ONES[lo] if lo < 10 else " " + two_digits(lo))


def speakable(text):
    return re.sub(r"\b(1[89]\d\d|20\d\d)\b", lambda m: year_words(int(m.group(1))), text)


def main(lines_path, out_dir, model_dir):
    sys.stdout.reconfigure(encoding="utf-8")
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    book = out / "manifest.json"
    old = json.loads(book.read_text(encoding="utf-8")).get("clips", {}) if book.exists() else {}
    old_by_file = {c["file"]: c for c in old.values()}
    lines = json.loads(pathlib.Path(lines_path).read_text(encoding="utf-8"))
    engine = None
    clips, made, kept = {}, 0, 0
    for line in lines:
        key = hashlib.sha1(f"{VOICE}|{VOICE_SPEED}|{SOUNDS}|{line['text']}".encode()).hexdigest()[:16]
        file = f"{key}.ogg"
        if (out / file).exists() and file in old_by_file:
            clips[line["text"]] = old_by_file[file]
            kept += 1
            continue
        if engine is None:
            model = pathlib.Path(model_dir)
            engine = Kokoro(str(model / "kokoro-v1.0.onnx"), str(model / "voices-v1.0.bin"))
        started = time.time()
        parts, marks, at = [], [], 0.0
        for n, sentence in enumerate(line["sentences"]):
            sounds = engine.tokenizer.phonemize(speakable(sentence), lang="en-us")
            for wrong, right in SOUNDS.items():
                sounds = sounds.replace(wrong, right)
            audio, rate = engine.create(sounds, voice=VOICE, speed=VOICE_SPEED, is_phonemes=True)
            if n:
                parts.append(numpy.zeros(int(GAP * rate), dtype=audio.dtype))
                at += GAP
            parts.append(audio)
            marks.append({"start": round(at, 3), "end": round(at + len(audio) / rate, 3)})
            at += len(audio) / rate
        soundfile.write(str(out / file), numpy.concatenate(parts), rate, format="OGG", subtype="VORBIS")
        clips[line["text"]] = {"file": file, "duration": round(at, 3), "marks": marks}
        made += 1
        print(f"  {line['id']}: {at:.1f} s of speech in {time.time() - started:.1f} s", flush=True)
    # Clips no line uses any more are removed, so data/voice only holds the current narration
    for stale in out.glob("*.ogg"):
        if stale.name not in {c["file"] for c in clips.values()}:
            stale.unlink()
    book.write_text(json.dumps({
        "engine": "kokoro-onnx", "model": "kokoro-v1.0", "voice": VOICE, "speed": VOICE_SPEED, "rate": VOICE_RATE,
        "madeAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "clips": clips,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Voice {VOICE} at {VOICE_SPEED}: {made} clip(s) made, {kept} unchanged.")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
