/**
 * mock memory behavior test: verify "Save rounds, recall only if asked about memory, recall can be distinguished,
 * isolate by pet, only keep 5 rounds, bad input will not be written".
 *
 * Running method: node --test tools/cordis-probe/test/mock-memory.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MOCK_RECALL_MARKER, createMockMemoryProvider } from '../lib/mock-memory.js';

test("Ordinary dialogue does not recall; after saving a round, ask \"remember\" to inject the latest round and ask for a review mark", () => {
  const memory = createMockMemoryProvider();
  assert.equal(memory.recall({ petId: 'main', userText: '你好' }), undefined);

  memory.capture({ petId: 'main', userText: '我喜欢咖啡', replyText: '记住啦', ts: 1 });
  assert.equal(memory.recall({ petId: 'main', userText: '你好' }), undefined, "Don’t inject without asking about memory");

  const patch = memory.recall({ petId: 'main', userText: '你记得我说过什么吗' });
  assert.ok(patch, "There must be a patch when asking about memory");
  assert.ok(patch.userText.includes('我喜欢咖啡'));
  assert.ok(patch.userText.includes(MOCK_RECALL_MARKER), "The model must be required to reread the mark, and the native history cannot generate it.");
  assert.match(patch.userText, /你记得我说过什么吗$/);
});

test("stats records capture times: bad input is not counted", () => {
  const memory = createMockMemoryProvider();
  assert.deepEqual(memory.stats(), { captured: 0 });

  memory.capture({ petId: 'main', userText: 'a', replyText: 'b', ts: 1 });
  memory.capture({ petId: 'main', userText: 1, replyText: 'b' });
  memory.capture({ petId: 'main', userText: 'q', replyText: null });
  assert.deepEqual(memory.stats(), { captured: 1 });
});

test("Isolate by pet: the memory of one pet will not enter the other", () => {
  const memory = createMockMemoryProvider();
  memory.capture({ petId: 'main', userText: 'A', replyText: 'a', ts: 1 });
  assert.equal(memory.recall({ petId: 'second', userText: '记得吗' }), undefined);
});

test("Only the latest 5 rounds are retained: the oldest one is eliminated, the latest one is still there", () => {
  const memory = createMockMemoryProvider();
  for (let i = 0; i < 7; i += 1) {
    memory.capture({ petId: 'main', userText: 'q' + i, replyText: 'a' + i, ts: i });
  }
  const patch = memory.recall({ petId: 'main', userText: '上次说什么' });
  assert.ok(patch);
  assert.match(patch.userText, /q6/);
  assert.doesNotMatch(patch.userText, /q1/);
});

test("Bad input is not written: skip if userText or replyText is not a character string", () => {
  const memory = createMockMemoryProvider();
  memory.capture({ petId: 'main', userText: 1, replyText: 'a' });
  memory.capture({ petId: 'main', userText: 'q', replyText: null });
  assert.equal(memory.recall({ petId: 'main', userText: '记得吗' }), undefined);
});
