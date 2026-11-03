import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sayHa, sayCount, sayDate, splitSentences, cueTime, storyLines } from '../src/narration.js';
import { buildStory } from '../src/story.js';
import { enrich, displayName } from '../src/data.js';

test('hectares and counts read the way a narrator says them', () => {
  assert.equal(sayHa(25_712_345), '25.7 million');
  assert.equal(sayHa(3_000_000), '3 million');
  assert.equal(sayHa(593_412), '593 thousand');
  assert.equal(sayHa(3_120.4), '3,120');
  assert.equal(sayCount(26_145), 'more than 26 thousand'); // rounded down, so it stays true
  assert.equal(sayCount(9_070), '9,070');
  assert.equal(sayDate('1998-07-07'), 'July 7, 1998');
});

test('sentences split on full stops but keep decimals whole', () => {
  assert.deepEqual(splitSentences('It grew 2.1 times. Watch it strike. 507 fires burned.'),
    ['It grew 2.1 times.', 'Watch it strike.', '507 fires burned.']);
  assert.deepEqual(splitSentences('  One line only  '), ['One line only']);
});

test('a cue lands on its word inside the right sentence', () => {
  const sentences = ['In 2025, the north burned.', 'Watch the season unfold.'];
  const marks = [{ start: 0, end: 2 }, { start: 2.3, end: 4.3 }];
  assert.equal(cueTime(sentences, marks, 'Watch'), 2.3);
  const mid = cueTime(sentences, marks, 'north');
  assert.ok(mid > 0.5 && mid < 1.5, `north at ${mid}`);
  assert.equal(cueTime(sentences, marks, 'absent'), null);
});

// A small synthetic record: enough fires per year to count as the continuous record
function fixture() {
  const fires = [];
  for (let y = 2000; y <= 2009; y++) {
    for (let i = 0; i < 120; i++) {
      fires.push({
        fire_id: `${String(y).slice(2)}LR-TEST${i}`, ignition_date: `${y}-0${5 + (i % 4)}-${String(1 + (i % 28)).padStart(2, '0')}`,
        size_ha: y === 2005 && i === 0 ? 90_000 : 10 + i, latitude: 55 + (i % 5) * 0.1, longitude: -105 - (i % 7) * 0.1,
        general_cause: i % 2 ? 'Lightning' : 'Human', fire_name: null,
      });
    }
  }
  return enrich(fires);
}

test('every chapter has a spoken line built from the data, with its cue word in it', () => {
  const story = buildStory(fixture(), displayName);
  assert.ok(story.chapters.length >= 6);
  for (const ch of story.chapters) {
    assert.ok(ch.say && !/<|>/.test(ch.say), `${ch.title}: plain spoken text`);
    for (const c of ch.cues ?? []) assert.ok(ch.say.includes(c.at), `${ch.title}: cue word "${c.at}" is spoken`);
  }
  assert.match(story.chapters[1].say, /^In 2005, the north burned\./);
  const lines = storyLines(story);
  assert.equal(lines.length, story.chapters.length + 2);
  assert.deepEqual(lines.map((l) => l.id).slice(0, 2), ['open', 'ch0']);
  for (const l of lines) assert.equal(l.text, l.sentences.join(' '));
});

test('a spread list adds the True Spread Replay chapter with the honest wording', () => {
  const spread = [{ id: 'nbac-2005-1', year: 2005, area_ha: 80_000, hs_sdate: '2005-06-01', hs_edate: '2005-06-30', hotspot_count: 4_200, cnfdb_fire_id: '05LR-TEST0', fire_name: null }];
  const story = buildStory(fixture(), displayName, { spread });
  const ch = story.chapters.find((c) => c.kicker === 'True spread replay');
  assert.ok(ch, 'spread chapter present');
  assert.match(ch.say, /Over 30 days, they detected it 4,200 times/);
  assert.match(ch.say, /interpolated between those real detections/);
});
