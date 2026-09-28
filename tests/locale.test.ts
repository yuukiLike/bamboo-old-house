import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, localeFromPathname, localeFromSegments, localePath } from '../src/content/locale.ts';
import { zh } from '../src/content/zh.ts';
import { en } from '../src/content/en.ts';
import { ja } from '../src/content/ja.ts';
import { WALK_CHAPTERS } from '../src/components/walk-navigation.ts';

await test('published suffixes select a language, including a trailing slash', () => {
  assert.equal(localeFromSegments(), 'en');
  for (const [path, locale] of [['/', 'en'], ['/cn', 'zh'], ['/ja', 'ja'], ['/en', 'en']]) {
    assert.equal(localeFromPathname(path), locale);
    assert.equal(localeFromSegments(path === '/' ? [] : [path.slice(1)]), locale);
    if (path !== '/') assert.equal(localeFromPathname(`${path}/`), locale);
  }
});

await test('language links use the English home page and the Chinese cn path', () => {
  assert.equal(localePath('en'), '/');
  assert.equal(localePath('zh'), '/cn');
  assert.equal(localePath('ja'), '/ja');
  for (const locale of LOCALES) assert.equal(localeFromPathname(localePath(locale)), locale);
});

await test('unknown or nested suffixes cannot silently become a language page', () => {
  for (const segments of [['zh'], ['EN'], ['CN'], ['fr'], ['en', 'ja'], ['cn', 'house'], ['ja', 'house']]) {
    assert.equal(localeFromSegments(segments), undefined);
  }
  for (const path of ['/english', '/enough', '/EN', '/CN', '/en/house', '/cn/house', '/cn//', '/ja//', '/zh']) {
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
