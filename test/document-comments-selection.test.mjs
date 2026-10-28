import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedCommentRange } from '../public/document-comments.js';

test('editor comment selection keeps the actual repeated occurrence in LF-normalized source', () => {
  const source = '# Review\r\n\r\n重复内容。\r\n\r\n重复内容。\r\n';
  const normalized = source.replaceAll('\r\n', '\n'); const from = normalized.lastIndexOf('重复');
  const actual = selectedCommentRange({ source, mode: 'live', editor: { selectedRange: () => ({ from, to: from + 4 }) }, lines: [], selection: null });
  assert.deepEqual(actual, { from, to: from + 4, text: '重复内容', fallback: false });
});

test('source-backed line comments are explicitly labeled as fallback and preserve physical lines', () => {
  const source = '# Review\n\n**Formatted** paragraph.\nNext line.\n';
  const actual = selectedCommentRange({ source, mode: 'preview', lines: new Set([4, 3]), selection: null });
  assert.deepEqual(actual, { from: source.indexOf('**'), to: source.length - 1, text: '**Formatted** paragraph.\nNext line.', fallback: true });
  assert.equal(selectedCommentRange({ source, mode: 'preview', lines: [], selection: null }), null);
});
