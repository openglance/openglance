import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedCommentRange, commentPopoverPosition } from '../public/document-comments.js';

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

test('comment action stays inside the viewport and moves below selections near the top toolbar', () => {
  const size = { width: 100, height: 40, viewportWidth: 800, viewportHeight: 600 };
  assert.deepEqual(commentPopoverPosition({ top: 150, bottom: 170, right: 300 }, size), { left: 200, top: 102 });
  assert.deepEqual(commentPopoverPosition({ top: 45, bottom: 65, right: 30 }, size), { left: 8, top: 73 });
  assert.deepEqual(commentPopoverPosition({ top: 590, bottom: 610, right: 900 }, size), { left: 692, top: 542 });
});
