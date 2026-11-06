/**
 * documentary.js: "Emberline Presents", the narrated documentary mode.
 *
 * Plays the guided story as a film inside the live app: a title card, then each chapter's scene
 * with its narration, captions and word-timed cues (the camera and replay move on the word that
 * describes them), then an end card. The map stays the real, interactive app, so pausing leaves the
 * viewer free to explore from that exact view.
 *
 * Voice: Kokoro clips made locally by `npm run make:voice` (af_heart, the IRISIdeas voice), matched
 * to each line by its exact text. A line without a clip falls back to the browser's speech voice,
 * and with no speech at all the captions run on estimated timing. The title card and control bar
 * say which voice is speaking, and that it is synthetic.
 *
 * Sound: a quiet wood fire crackling underneath (fireplace.js), livelier in the big chapters, with a
 * pop for each of the chapter's largest real fires. It ducks under every spoken line; the flame
 * button mutes it, and the choice is remembered.
 */
import { CONFIG, apiUrl } from './config.js';
import { esc } from './data.js';
import { storyLines, cueTime } from './narration.js';
import { createFireplace } from './fireplace.js';

const $ = (s) => document.querySelector(s);
const CHARS_PER_SEC = 15; // speaking rate used to estimate timing when there is no clip
const TITLE_HOLD = 1.2;
const DEFAULT_HOLD = 2;
const SOUND_KEY = 'emberline.filmFire';
const END_FADE = 9; // seconds the fire takes to fade out under the end card

function soundPref() { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } }
function saveSoundPref(on) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } }

class Cancelled extends Error {}

export function createDocumentary({ app, getStory, showChapter, onStart, onStop, dataset }) {
  let manifest = null;
  let run = 0;            // bumped to cancel the running film
  let active = false;
  let paused = false;
  let line = null;        // the line being spoken: { pause, resume, finish }
  let held = null;        // the hold timer being waited on: { finish }
  let skipping = false;   // set by next() until the following chapter starts
  let fire = null;        // the crackling fire under the film
  let resumeScene = null;
  const blobs = new Map(); // clip file → object URL

  async function loadManifest() {
    if (manifest || CONFIG.staticDataUrl) return manifest ?? { clips: {} };
    try {
      const res = await fetch(apiUrl('/voice'));
      manifest = res.ok ? await res.json() : { clips: {} };
    } catch { manifest = { clips: {} }; }
    return manifest;
  }

  const clipFor = (text) => manifest?.clips?.[text] ?? null;
  function fetchClip(clip) {
    if (!blobs.has(clip.file)) {
      blobs.set(clip.file, fetch(apiUrl(`/voice/${clip.file}`))
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => URL.createObjectURL(b))
        .catch(() => { blobs.delete(clip.file); return null; }));
    }
    return blobs.get(clip.file);
  }

  function voiceLabel(lines) {
    const n = lines.filter((l) => clipFor(l.text)).length;
    if (n === lines.length) return { short: `Kokoro · ${manifest.voice}`, long: `Narration uses a synthetic voice: Kokoro (${manifest.voice}), generated locally.` };
    const browser = 'speechSynthesis' in globalThis ? "the browser's synthetic voice" : 'captions only (no speech available)';
    if (!n) return { short: 'Browser voice', long: `Narration uses ${browser}. Run "npm run make:voice" for the Kokoro voice.` };
    return { short: `Kokoro + browser`, long: `Narration uses a synthetic voice: Kokoro where clips match the loaded data, otherwise ${browser}.` };
  }

  // ---------------------------------------------------------------- one spoken line
  /**
   * Speak `l` and resolve when it ends (or `finish()` is called). `onTime(t, sentenceIndex)` is called
   * as it plays, with t in seconds on the same scale as the line's marks.
   */
  function speak(l, onTime) {
    const clip = clipFor(l.text);
    if (clip) return speakClip(l, clip, onTime);
    if ('speechSynthesis' in globalThis && speechSynthesis.getVoices().length) return speakBrowser(l, onTime);
    return speakSilent(l, onTime);
  }

  const estimatedMarks = (l) => {
    let at = 0;
    return l.sentences.map((s) => { const m = { start: at, end: at + s.length / CHARS_PER_SEC }; at = m.end + 0.3; return m; });
  };
  const sentenceAt = (marks, t) => { let i = 0; while (i < marks.length - 1 && t >= marks[i + 1].start) i++; return i; };

  function speakClip(l, clip, onTime) {
    let audio, timer, done;
    const finished = new Promise((resolve) => { done = resolve; });
    const end = () => { clearInterval(timer); audio?.pause(); done(); };
    fetchClip(clip).then((url) => {
      if (!url) { speakSilent(l, onTime, clip.marks).finished.then(done); return; }
      audio = new Audio(url);
      audio.addEventListener('ended', end);
      timer = setInterval(() => onTime(audio.currentTime, sentenceAt(clip.marks, audio.currentTime)), 50);
      onTime(0, 0);
      if (!paused) audio.play().catch(() => { clearInterval(timer); speakSilent(l, onTime, clip.marks).finished.then(done); });
    });
    return {
      marks: clip.marks, finished,
      pause: () => audio?.pause(),
      resume: () => audio?.play().catch(() => {}),
      finish: end,
    };
  }

  function speakBrowser(l, onTime) {
    const marks = estimatedMarks(l);
    let i = 0, startedAt = 0, timer, done, cancelled = false;
    const finished = new Promise((resolve) => { done = resolve; });
    const end = () => { cancelled = true; clearInterval(timer); speechSynthesis.cancel(); done(); };
    const say = () => {
      if (cancelled) return;
      if (i >= l.sentences.length) { end(); return; }
      const u = new SpeechSynthesisUtterance(l.sentences[i]);
      u.lang = 'en-CA';
      u.rate = 0.97;
      u.onstart = () => { startedAt = performance.now(); };
      u.onend = () => { i++; say(); };
      u.onerror = () => { i++; say(); };
      startedAt = performance.now();
      speechSynthesis.speak(u);
    };
    timer = setInterval(() => {
      if (paused || i >= marks.length) return;
      const m = marks[i];
      onTime(Math.min(m.end, m.start + (performance.now() - startedAt) / 1000), i);
    }, 50);
    speechSynthesis.cancel();
    say();
    let pausedAt = 0;
    return {
      marks, finished,
      pause: () => { pausedAt = performance.now(); speechSynthesis.pause(); },
      resume: () => { startedAt += performance.now() - pausedAt; speechSynthesis.resume(); },
      finish: end,
    };
  }

  function speakSilent(l, onTime, marks = estimatedMarks(l)) {
    const total = marks[marks.length - 1].end;
    let t = 0, last = performance.now(), done, timer;
    const finished = new Promise((resolve) => { done = resolve; });
    const end = () => { clearInterval(timer); done(); };
    timer = setInterval(() => {
      const now = performance.now();
      if (!paused) t += (now - last) / 1000;
      last = now;
      onTime(Math.min(t, total), sentenceAt(marks, t));
      if (t >= total) end();
    }, 50);
    return { marks, finished, pause() {}, resume() {}, finish: end };
  }

  /** Wait `sec` seconds of unpaused time. */
  function hold(sec) {
    if (skipping) return Promise.resolve();
    let done, timer, t = 0, last = performance.now();
    const finished = new Promise((resolve) => { done = resolve; });
    const finish = () => { clearInterval(timer); done(); };
    timer = setInterval(() => {
      const now = performance.now();
      if (!paused) t += (now - last) / 1000;
      last = now;
      if (t >= sec) finish();
    }, 50);
    held = { finish };
    return finished.then(() => { held = null; });
  }

  // ---------------------------------------------------------------- captions
  function caption(text) {
    const el = $('#doc-caption');
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.textContent = text;
    el.classList.toggle('on', !!text);
    el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
  }

  /** Speak a line with captions and cues; resolves when it has been spoken. */
  async function narrate(l, cues = [], token) {
    const fired = new Set();
    let marks = null;
    line = speak(l, (t, i) => {
      if (token !== run) return;
      caption(l.sentences[i] ?? '');
      cues.forEach((c, k) => {
        if (fired.has(k)) return;
        const at = cueTime(l.sentences, marks, c.at) ?? 0;
        if (t >= at) { fired.add(k); c.run(app); }
      });
    });
    marks = line.marks;
    fire?.duck(true);
    await line.finished;
    fire?.duck(false);
    line = null;
    if (token !== run) throw new Cancelled();
    cues.forEach((c, k) => fired.has(k) || c.run(app)); // a cue whose word was skipped still runs
  }

  // ---------------------------------------------------------------- cards and controls
  function card(kind, story, voice) {
    const el = $('#doc-card');
    el.dataset.kind = kind;
    el.innerHTML = kind === 'title'
      ? `<p class="eyebrow">Emberline presents</p>
         <h1>A Province of Fire</h1>
         <p class="doc-sub">${esc(story.opening.replace(/^Emberline presents\.\s*/, ''))}</p>
         ${dataset().simulated ? '<p class="doc-sim">SIMULATED DATA · synthetic demo dataset, not the real record</p>' : ''}
         <p class="doc-disclose">${esc(voice.long)}<br/>Every figure is computed from ${esc(dataset().label)}.</p>`
      : `<p class="eyebrow">The end</p>
         <h1>Your turn</h1>
         <p class="doc-sub">${esc(story.closing)}</p>
         <div class="doc-end"><button class="cta" id="doc-explore">Explore the map</button><button class="ghost" id="doc-again">↻ Watch again</button></div>`;
    el.hidden = false;
    el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
    if (kind === 'end') {
      $('#doc-explore').onclick = () => { stop(); app.set({ mode: 'explore' }); };
      $('#doc-again').onclick = () => start();
    }
  }
  function hideCard() {
    const el = $('#doc-card');
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => { if (el.classList.contains('out')) el.hidden = true; }, 900);
  }

  function setPaused(p) {
    if (!active || p === paused) return;
    paused = p;
    $('#doc-pause').classList.toggle('paused', p);
    $('#doc-pause').setAttribute('aria-label', p ? 'Resume' : 'Pause');
    document.body.classList.toggle('doc-paused', p);
    if (p) { line?.pause(); fire?.pause(); resumeScene = app.pause(); } else { line?.resume(); fire?.resume(); resumeScene?.(); resumeScene = null; }
  }

  /** Number counters in the chapter text count up from zero, as in a broadcast graphic. */
  function countUp(root) {
    for (const b of root.querySelectorAll('b')) {
      const m = b.textContent.match(/^([\d,]*\.?\d+)(.*)$/);
      if (!m) continue;
      const target = Number(m[1].replace(/,/g, ''));
      const decimals = (m[1].split('.')[1] ?? '').length;
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1600), e = 1 - (1 - k) ** 3;
        b.textContent = (target * e).toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + m[2];
        if (k < 1 && b.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  // ---------------------------------------------------------------- the film
  async function start() {
    stop({ quiet: true });
    const token = ++run;
    const alive = () => { if (token !== run) throw new Cancelled(); };
    active = true;
    paused = false;
    skipping = false;
    document.body.classList.add('doc-mode');
    $('#doc-bar').hidden = false;
    onStart();
    // Created inside the click, so the browser lets it play
    fire = createFireplace();
    fire?.setMuted(!soundPref());
    fire?.begin();
    syncSound();
    await loadManifest();
    const story = getStory();
    const lines = storyLines(story);
    const voice = voiceLabel(lines);
    $('#doc-voice').textContent = `🔊 ${voice.short} · synthetic voice`;
    $('#doc-voice').title = voice.long;
    $('#doc-progress').innerHTML = story.chapters.map(() => '<i></i>').join('');
    lines.forEach((l) => clipFor(l.text) && fetchClip(clipFor(l.text))); // warm every clip
    try {
      card('title', story, voice);
      await narrate(lines[0], [], token);
      await hold(TITLE_HOLD);
      alive();
      hideCard();
      for (let i = 0; i < story.chapters.length; i++) {
        const ch = story.chapters[i];
        [...$('#doc-progress').children].forEach((el, k) => el.classList.toggle('on', k <= i));
        skipping = false;
        showChapter(i, { doc: true });
        fire?.chapter(i, ch.sound?.fires, ch.sound);
        countUp($('#story-body'));
        await narrate(lines[i + 1], ch.cues ?? [], token);
        await hold(ch.hold ?? DEFAULT_HOLD);
        alive();
      }
      caption('');
      alive();
      card('end', story, voice);
      fire?.end();
      await narrate(lines[lines.length - 1], [], token);
      caption('');
      fire?.stop(END_FADE);
      fire = null;
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
  }

  /** Skip the rest of this chapter (its cues still run, so the scene is where it should be). */
  function next() {
    if (!active) return;
    if (paused) setPaused(false);
    skipping = true;
    line?.finish();
    held?.finish();
  }

  function stop({ quiet = false } = {}) {
    if (!active) return;
    run++;
    active = false;
    if (paused) { paused = false; resumeScene?.(); resumeScene = null; }
    line?.finish();
    held?.finish();
    if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
    fire?.stop(quiet ? 0.3 : 1.2);
    fire = null;
    caption('');
    $('#doc-card').hidden = true;
    $('#doc-bar').hidden = true;
    document.body.classList.remove('doc-mode', 'doc-paused');
    if (!quiet) onStop();
  }

  $('#doc-pause').addEventListener('click', () => setPaused(!paused));
  $('#doc-next').addEventListener('click', next);
  $('#doc-exit').addEventListener('click', () => stop());
  function syncSound() {
    const on = soundPref();
    $('#doc-fire').classList.toggle('off', !on);
    $('#doc-fire').setAttribute('aria-pressed', String(on));
    $('#doc-fire').title = on ? 'Fire sound on (click to mute)' : 'Fire sound off (click to play)';
  }
  $('#doc-fire').addEventListener('click', () => {
    const on = !soundPref();
    saveSoundPref(on);
    fire?.setMuted(!on);
    syncSound();
  });
  // Some browsers load speech voices lazily; asking early means they are ready by the first line
  if ('speechSynthesis' in globalThis) speechSynthesis.getVoices();

  return {
    start, stop, next,
    toggle: () => setPaused(!paused),
    get active() { return active; },
  };
}
