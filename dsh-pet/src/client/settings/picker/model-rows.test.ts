/**
 * Contract testing of model selector rows.
 *
 * Three contracts:
 * 1. "Follow current conversation" is not a model: it only appears when there is no search term;
 * 2. The search is case-insensitive ordered subsequence matching, and the entire group of service providers that
 * cannot be hit will not be displayed;
 * 3. Add a line "No model available" only if "there is no search term and the service provider does not have a model".
 * In other cases, no prompt line will be generated.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildModelRows, matchModelQuery, selectableIndexes, type ModelCatalogGroup } from './model-rows.ts';

const catalog: ModelCatalogGroup[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'o3', name: 'o3' },
    ],
  },
  {
    id: 'empty',
    name: '无模型服务商',
    models: [],
  },
];

const kinds = (rows: ReturnType<typeof buildModelRows>): string[] => rows.map((row) => row.kind);

describe('matchModelQuery - Search semantics', () => {
  test('Empty search terms hit everything; pure whitespace equals empty', () => {
    assert.equal(matchModelQuery('GPT-4o', ''), true);
    assert.equal(matchModelQuery('GPT-4o', '   '), true);
  });

  test('Case-insensitive ordered subsequence: gpt4 hits GPT-4o', () => {
    assert.equal(matchModelQuery('GPT-4o', 'gpt4'), true);
    assert.equal(matchModelQuery('GPT-4o', 'GpT4O'), true);
  });

  test('The characters are in the wrong order or all characters are missing, so there is no hit.', () => {
    assert.equal(matchModelQuery('GPT-4o', '4gpt'), false, 'Subsequences must maintain their original order');
    assert.equal(matchModelQuery('GPT-4o', 'gpt5'), false);
    assert.equal(matchModelQuery('GPT-4o', 'gpt4oo'), false, 'Repeated characters cannot be hit out of thin air');
  });
});

describe('buildModelRows - line list', () => {
  test('No search terms: first "Follow the current conversation", then a group header for each service provider + all models in the group', () => {
    const rows = buildModelRows(catalog, '');
    assert.deepEqual(kinds(rows), ['follow', 'group', 'model', 'model', 'group', 'none']);
    assert.equal(rows[1].kind === 'group' ? rows[1].name : '', 'OpenAI');
  });

  test('There is a search term: "Follow current conversation" does not appear (it is not a model)', () => {
    const rows = buildModelRows(catalog, 'gpt');
    assert.equal(
      rows.some((row) => row.kind === 'follow'),
      false,
    );
  });

  test('There is a search term: if no one in the group is hit, the whole group disappears, not even the group header is left.', () => {
    const rows = buildModelRows(catalog, 'gpt');
    assert.deepEqual(kinds(rows), ['group', 'model']);
    assert.equal(rows[0].key, 'openai', 'The remaining packet header must be the hit service provider');
  });

  test('Empty service provider: When there is no search term, the group header + a line "No available model" is left, and when there is a search term, the entire group disappears', () => {
    const idle = buildModelRows(catalog, '');
    assert.deepEqual(kinds(idle).slice(-2), ['group', 'none']);
    const searching = buildModelRows(catalog, 'zzz');
    assert.deepEqual(kinds(searching), []);
  });

  test('OK key only: models with the same name will not hit keys under different service providers', () => {
    const rows = buildModelRows(
      [
        { id: 'a', name: 'A', models: [{ id: 'same', name: '同名' }] },
        { id: 'b', name: 'B', models: [{ id: 'same', name: '同名' }] },
      ],
      '',
    );
    const keys = rows.map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length, 'If key collides, React will reuse the wrong node.');
  });
});

describe('selectableIndexes ——The position where the keyboard can move', () => {
  test('Skip the group header and prompt line, leaving only the model and "Follow current conversation"', () => {
    const rows = buildModelRows(catalog, '');
    const selectable = selectableIndexes(rows);
    assert.deepEqual(
      selectable.map((index) => rows[index].kind),
      ['follow', 'model', 'model'],
    );
  });

  test('Return an empty array when there is no optional row (keyboard movement must return directly)', () => {
    assert.deepEqual(
      selectableIndexes(buildModelRows([], '')),
      [0],
      '"Follow current conversation" still exists when the list is empty',
    );
    assert.deepEqual(selectableIndexes(buildModelRows(catalog, 'zzz')), []);
  });
});
