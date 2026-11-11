/**
 * To-be-doed unit test of wire parsing and sorting: Dirty data will not enter the rendering layer, and the order will
 * be "unfinished, due soon, and indefinite at the bottom".
 *
 * Running method: node --experimental-strip-types --test src/shared/todo/types.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTodoItem, parseTodoList, sortTodoItems } from './types.ts';

/** Create a valid record. */
const valid = {
  id: 'todo-1',
  text: '交周报',
  dueAt: 1000,
  done: false,
  createdAt: 10,
  updatedAt: 20,
  completedAt: null,
};

describe('parseTodoItem——Single narrowing', () => {
  test('Read valid records field by field', () => {
    const todo = parseTodoItem(valid);
    assert.deepEqual(todo, {
      id: 'todo-1',
      text: '交周报',
      dueAt: 1000,
      done: false,
      createdAt: 10,
      updatedAt: 20,
      completedAt: null,
    });
  });

  test('dueAt can be default or null; done only recognizes Boolean', () => {
    assert.equal(parseTodoItem({ ...valid, dueAt: null })?.dueAt, null);
    assert.equal(parseTodoItem({ ...valid, dueAt: undefined })?.dueAt, null);
    assert.equal(parseTodoItem({ ...valid, done: 'yes' })?.done, false);
  });

  test('id is missing / text is missing / dueAt is not a number → null', () => {
    assert.equal(parseTodoItem({ ...valid, id: '' }), null);
    assert.equal(parseTodoItem({ ...valid, text: 42 }), null);
    assert.equal(parseTodoItem({ ...valid, dueAt: '1000' }), null);
    assert.equal(parseTodoItem(null), null);
    assert.equal(parseTodoItem([valid]), null);
  });
});

describe('parseTodoList - the entire list', () => {
  test('Not an array → empty list; bad entries skipped, good entries retained', () => {
    assert.deepEqual(parseTodoList(null), []);
    assert.deepEqual(parseTodoList({ todos: [] }), []);
    const list = parseTodoList([valid, { id: '' }, { ...valid, id: 'todo-2' }]);
    assert.deepEqual(
      list.map((item) => item.id),
      ['todo-1', 'todo-2'],
    );
  });
});

describe('sortTodoItems——Display order', () => {
  test('Unfinished first, in order of expiration, indefinite, last', () => {
    const base = { done: false, createdAt: 1, updatedAt: 1, completedAt: null as number | null };
    const list = sortTodoItems([
      { ...base, id: 'done', text: '已完成', dueAt: 1, done: true, completedAt: 9 },
      { ...base, id: 'undated', text: '无期限', dueAt: null },
      { ...base, id: 'late', text: '晚', dueAt: 300 },
      { ...base, id: 'early', text: '早', dueAt: 200 },
    ]);
    assert.deepEqual(
      list.map((item) => item.id),
      ['early', 'late', 'undated', 'done'],
    );
  });

  test('The same expiration time is based on the order of creation.', () => {
    const list = sortTodoItems([
      { id: 'b', text: 'b', dueAt: 5, done: false, createdAt: 2, updatedAt: 2, completedAt: null },
      { id: 'a', text: 'a', dueAt: 5, done: false, createdAt: 1, updatedAt: 1, completedAt: null },
    ]);
    assert.deepEqual(
      list.map((item) => item.id),
      ['a', 'b'],
    );
  });
});
