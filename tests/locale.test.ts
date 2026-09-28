import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, localeFromPathname, localeFromSegments, localePath } from '../src/content/locale.ts';
import { zh } from '../src/content/zh.ts';
import { en } from '../src/content/en.ts';
import { ja } from '../src/content/ja.ts';
import { WALK_CHAPTERS } from '../src/components/walk-navigation.ts';

await test('published suffixes select a language, including a trailing slash', () => {
  assert.equal(localeFromSegments(), 'zh');
  for (const locale of LOCALES) {
    const path = localePath(locale);
    assert.equal(localeFromPathname(path), locale);
    assert.equal(localeFromSegments(locale === 'zh' ? [] : [locale]), locale);
    if (locale !== 'zh') assert.equal(localeFromPathname(`${path}/`), locale);
  }
});

await test('unknown or nested suffixes cannot silently become a language page', () => {
  for (const segments of [['zh'], ['EN'], ['fr'], ['en', 'ja'], ['ja', 'house']]) {
    assert.equal(localeFromSegments(segments), undefined);
  }
  for (const path of ['/english', '/enough', '/EN', '/en/house', '/ja//', '/zh']) {
    assert.equal(localeFromPathname(path), undefined);
  }
});

await test('each language covers the same scene identifiers and progress placeholder', () => {
  const ids = WALK_CHAPTERS.map(chapter => chapter.id);
  for (const text of [zh, en, ja]) {
    assert.deepEqual(Object.keys(text.chapters), ids);
    assert.equal(text.ui.progress.match(/\{percent\}/g)?.length, 1);
    assert.ok(text.chapters.bamboo.copy.length > 0);
    assert.ok(text.well.copy.length > 0);
  }
});
