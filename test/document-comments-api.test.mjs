import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPreviewServer } from '../src/server/index.mjs';
import { parseComments } from '../src/server/document-comments-format.mjs';
import { commentSelection, commentsPayload } from '../src/server/document-comments.mjs';
const exec = promisify(execFile);
async function fixture(t, source = '# Review\r\n\r\nRepeated text.\r\n\r\nRepeated text.\r\n') {
  const root = await mkdtemp(path.join(tmpdir(), 'openglance-comments-api-'));
  const git = async (...args) => (await exec('git', args, { cwd: root })).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(root, 'review.md'), source); await writeFile(path.join(root, 'review.mdx'), '# MDX\n');
  await git('add', '.'); await git('commit', '-m', 'Fixture');
  const server = createPreviewServer({ repoRoot: root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (file = 'review.md') => fetch(`${base}/api/document?file=${file}`).then((r) => r.json());
  const post = (input, route = 'document-comments', file = 'review.md', headers = {}) => fetch(`${base}/api/${route}?file=${file}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  return { root, source, git, get, post };
}

test('HTTP create, reply, resolve, and reopen keep body bytes and history local until manual publication', async (t) => {
  const { root, source, git, get, post } = await fixture(t);
  const head = await git('rev-parse', 'HEAD');
  let doc = await get(); const initialHash = doc.sourceHash;
  const normalized = source.replaceAll('\r\n', '\n'); const from = normalized.lastIndexOf('Repeated');
  let response = await post({ type: 'create', expectedSourceHash: doc.sourceHash, from, to: from + 8, body: '<script>window.bad=1</script>\n**Review**', authorName: 'Reviewer' });
  assert.equal(response.status, 200); doc = await response.json();
  let thread = doc.comments.threads[0]; const id = thread.id;
  assert.equal(thread.location.startLine, 5, 'the actual second occurrence is anchored');
  assert.equal(thread.anchor.exact, 'Repeated');
  assert.doesNotMatch(doc.html, /openglance-comment|window.bad|Reviewer/);
  assert.equal((await readFile(path.join(root, 'review.md'), 'utf8')).startsWith(source), true);
  response = await post({ source, expectedSourceHash: initialHash }, 'document');
  assert.equal(response.status, 409, 'an old editor buffer cannot erase new comments');
  response = await post({ type: 'reply', threadId: id, body: 'Reply from sidebar', expectedSourceHash: doc.sourceHash });
  assert.equal(response.status, 200); doc = await response.json();
  assert.equal(doc.comments.threads[0].messages.length, 2);
  const body = parseComments(doc.source).body;
  for (const status of ['resolved', 'open']) {
    response = await post({ type: 'set-status', threadId: id, status, expectedSourceHash: doc.sourceHash });
    assert.equal(response.status, 200); doc = await response.json();
    assert.equal(doc.comments.threads[0].status, status);
    assert.equal(doc.comments.threads[0].messages.length, 2);
    assert.equal(parseComments(doc.source).body, body);
  }
  assert.equal((await get()).comments.threads[0].status, 'open', 'reopening survives a document reload');
  assert.equal(await git('rev-parse', 'HEAD'), head, 'no local action commits or publishes');
  assert.equal(await git('diff', '--cached'), '');
  assert.equal((await git('status', '--porcelain')).trim(), 'M review.md');
});

test('comment endpoint rejects stale versions, missing hashes, MDX, record selections, and untrusted origins without writes', async (t) => {
  const { root, source, get, post } = await fixture(t);
  const doc = await get();
  const input = { type: 'create', body: 'Draft', from: 0, to: 8, expectedSourceHash: doc.sourceHash };
  for (const [changed, route, file, headers, status] of [
    [{ ...input, expectedSourceHash: undefined }, 'document-comments', 'review.md', {}, 400],
    [{ ...input, expectedSourceHash: '0'.repeat(64) }, 'document-comments', 'review.md', {}, 409],
    [input, 'document-comments', 'review.mdx', {}, 400],
    [input, 'document-comments', 'review.md', { Origin: 'https://untrusted.example' }, 403],
    [{ ...input, type: 'delete' }, 'document-comments', 'review.md', {}, 400],
    [{ source: '# old' }, 'document', 'review.md', {}, 400],
  ]) assert.equal((await post(changed, route, file, headers)).status, status);
  assert.equal(await readFile(path.join(root, 'review.md'), 'utf8'), source);
  const response = await post(input); const added = await response.json();
  const record = parseComments(added.source.replaceAll('\r\n', '\n')).records[0];
  assert.throws(() => commentSelection(added.source, record.from, record.to), { code: 'invalid_range' });
});

test('comment locations use physical source lines around records, while malformed records stay opaque', async (t) => {
  const { get, post } = await fixture(t, '# Review\n\nFirst paragraph.\n\nLast paragraph.\n');
  let doc = await get();
  const response = await post({ type: 'create', from: 10, to: 15, body: 'First', expectedSourceHash: doc.sourceHash });
  doc = await response.json();
  const parsed = parseComments(doc.source);
  const moved = doc.source.slice(0, parsed.records[0].from) + '<!-- openglance-comment:v9\n{}\n-->\n\n' + parsed.records[0].raw + '\nAfter records.\n';
  const meta = commentsPayload(moved, 'review.md');
  assert.equal(meta.threads.length, 1); assert.equal(meta.threads[0].location.startLine, 3);
  assert.equal(meta.diagnostics[0].code, 'unknown_version');
});
