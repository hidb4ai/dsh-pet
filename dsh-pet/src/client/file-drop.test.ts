/**
 * Single test of drag and drop claim: who will receive drop this time, whether to block the default behavior, whether
 * to block bubbling and replace host cleanup.
 *
 * Why it’s worth nailing: Desktop pet and DSH both contain drop in the same DOM tree. One less block will appear as
 * "the same picture goes into two places", and one more block will cause DSH's own drag processing to completely fail
 * - neither error will be reported.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimFileDragEnter,
  claimFileDragOver,
  claimFileDrop,
  DROP_TARGET_CLASS,
  markDropTarget,
  unmarkDropTarget,
} from './file-drop.ts';
import type { DragLike, DropTargetLike } from './file-drop.ts';

/** Only create the two fields used for judgment: the implementation does not read other members of File. */
const file = (type: string, name: string): File => ({ type, name }) as File;

/** Write down how many times the event was blocked, and use it to assert whether the event was touched or not. */
interface Recorder {
  readonly event: DragLike;
  readonly calls: { prevent: number; stop: number };
}

/** Create a drag and drop: the file list determines the content, and hasFiles determines whether it counts as file drag and drop. */
function dragOf(files: readonly File[], hasFiles = true): Recorder {
  const calls = { prevent: 0, stop: 0 };
  return {
    event: {
      dataTransfer: { files, types: hasFiles ? ['Files'] : ['text/plain'] } as unknown as DataTransfer,
      preventDefault: () => {
        calls.prevent += 1;
      },
      stopPropagation: () => {
        calls.stop += 1;
      },
    },
    calls,
  };
}

/** Create a fake window that is only used for cleanup events and tear it down after running so as not to affect other use cases. */
function withFakeWindow(run: (events: string[]) => void): void {
  const events: string[] = [];
  const globals = globalThis as { window?: unknown };
  globals.window = {
    dispatchEvent: (event: Event): boolean => {
      events.push(event.type);
      return true;
    },
  };
  try {
    run(events);
  } finally {
    delete globals.window;
  }
}

describe('claimFileDragEnter', () => {
  test('Bring files into the drop point: block bubbling and close the host mask', () => {
    withFakeWindow((events) => {
      const { event, calls } = dragOf([file('image/png', 'a.png')]);
      assert.equal(claimFileDragEnter(event), true, 'If you bring documents, you should claim them');
      assert.deepEqual(
        calls,
        { prevent: 0, stop: 1 },
        'Only bubbling is stopped, the default behavior is left to dragover',
      );
      assert.deepEqual(events, ['dragend'], 'The full page mask should be collapsed for host');
    });
  });

  test('Dragging plain text into the drop point: not claimed, neither the event nor the mask is moved', () => {
    withFakeWindow((events) => {
      const { event, calls } = dragOf([], false);
      assert.equal(claimFileDragEnter(event), false, 'The file is not dragged and should not be claimed.');
      assert.deepEqual(calls, { prevent: 0, stop: 0 }, 'If you don’t claim it, you can’t move the event.');
      assert.deepEqual(events, [], 'You should not touch the host mask without claiming it.');
    });
  });
});

describe('claimFileDragOver', () => {
  test('Drag-and-drop process with files: claim and block default behavior and bubbling at the same time', () => {
    const { event, calls } = dragOf([file('image/png', 'a.png')]);
    assert.equal(claimFileDragOver(event), true, 'If you bring documents, you should claim them');
    assert.deepEqual(calls, { prevent: 1, stop: 1 }, 'You must stop both when claiming.');
  });

  test('Plain text drag and drop pass: neither claims nor touches the event', () => {
    const { event, calls } = dragOf([], false);
    assert.equal(claimFileDragOver(event), false, 'The file is not dragged and should not be claimed.');
    assert.deepEqual(calls, { prevent: 0, stop: 0 }, 'If you don’t claim it, you can’t move the event.');
  });
});

describe('claimFileDrop', () => {
  test('Picture falling on the interface: return the picture and truncate the event', () => {
    const image = file('image/png', 'a.png');
    const { event, calls } = dragOf([image]);
    assert.equal(claimFileDrop(event), image, 'The picture dragged in should be returned');
    assert.deepEqual(calls, { prevent: 1, stop: 1 }, 'You must stop both when claiming.');
  });

  test('Multiple files: skip non-pictures and take the first picture', () => {
    const image = file('image/webp', 'b.webp');
    const { event } = dragOf([file('text/plain', 'a.txt'), image]);
    assert.equal(claimFileDrop(event), image, 'The previous text file should be skipped');
  });

  test('Only non-picture files: swallow events but not into pictures', () => {
    const { event, calls } = dragOf([file('application/pdf', 'a.pdf')]);
    assert.equal(claimFileDrop(event), undefined, 'The picture cannot be recognized and should return undefined');
    assert.deepEqual(
      calls,
      { prevent: 1, stop: 1 },
      'It is still dragging and dropping files, which must be stopped to prevent the page from being replaced.',
    );
  });

  test('No file drag: event not touched', () => {
    const { event, calls } = dragOf([], false);
    assert.equal(claimFileDrop(event), undefined);
    assert.deepEqual(
      calls,
      { prevent: 0, stop: 0 },
      'Drag and drop items that do not belong to you must be released as they are.',
    );
  });

  test('After claiming, replace the host once with dragend: the mask will not hang all the time.', () => {
    withFakeWindow((events) => {
      const { event } = dragOf([file('image/png', 'a.png')]);
      claimFileDrop(event);
      assert.deepEqual(events, ['dragend'], 'dragend should be distributed to window and only once');
    });
  });

  test('Not file drag and drop: do not touch the mask state of the host', () => {
    withFakeWindow((events) => {
      const { event } = dragOf([], false);
      claimFileDrop(event);
      assert.deepEqual(events, [], 'Drag and drop that does not belong to you should not be distributed dragend');
    });
  });
});

/** Minimal DOM stand-in: only classList and contains used for highlighting are implemented. */
class FakeElement {
  readonly classes = new Set<string>();
  readonly children: FakeElement[] = [];
  readonly classList = {
    add: (one: string): void => {
      this.classes.add(one);
    },
    remove: (one: string): void => {
      this.classes.delete(one);
    },
    contains: (one: string): boolean => this.classes.has(one),
  };

  contains(node: unknown): boolean {
    return node === this || this.children.includes(node as FakeElement);
  }
}

/** Temporarily replace HTMLElement / Node with a stand-in and restore it after running, so as not to affect other use cases. */
function withFakeDom(run: () => void): void {
  const globals = globalThis as { HTMLElement?: unknown; Node?: unknown };
  const savedElement = globals.HTMLElement;
  const savedNode = globals.Node;
  globals.HTMLElement = FakeElement;
  globals.Node = FakeElement;
  try {
    run();
  } finally {
    globals.HTMLElement = savedElement;
    globals.Node = savedNode;
  }
}

/** Create a landing point event: currentTarget is the landing point, relatedTarget is the place to go when leaving. */
function dropTargetOf(el: FakeElement, related: unknown, hasFiles = true): DropTargetLike {
  const seed = hasFiles ? [file('image/png', 'a.png')] : [];
  const { event } = dragOf(seed, hasFiles);
  return {
    ...event,
    currentTarget: el as unknown as EventTarget,
    relatedTarget: related as EventTarget | null,
  };
}

describe('markDropTarget', () => {
  test('Bring files into the landing point: add the highlight class and close the host mask', () => {
    withFakeDom(() => {
      withFakeWindow((events) => {
        const el = new FakeElement();
        markDropTarget(dropTargetOf(el, null));
        assert.equal(
          el.classes.has(DROP_TARGET_CLASS),
          true,
          'Highlighting should be added when entering the landing point',
        );
        assert.deepEqual(events, ['dragend'], 'The full page mask of host should also be collapsed');
      });
    });
  });

  test('Drag and drop plain text into the drop point: no highlighting class', () => {
    withFakeDom(() => {
      withFakeWindow((events) => {
        const el = new FakeElement();
        markDropTarget(dropTargetOf(el, null, false));
        assert.equal(
          el.classes.has(DROP_TARGET_CLASS),
          false,
          'It should not be highlighted if the file is not dragged',
        );
        assert.deepEqual(events, [], 'Don’t touch the host mask either');
      });
    });
  });
});

describe('unmarkDropTarget', () => {
  test('The pointer moves to the child element of the landing point: the highlight is retained', () => {
    withFakeDom(() => {
      const el = new FakeElement();
      const child = new FakeElement();
      el.children.push(child);
      el.classes.add(DROP_TARGET_CLASS);
      unmarkDropTarget(dropTargetOf(el, child));
      assert.equal(
        el.classes.has(DROP_TARGET_CLASS),
        true,
        'Moving between sub-elements does not count as leaving and cannot be flashed',
      );
    });
  });

  test('Really leaving or letting go: remove the highlight', () => {
    withFakeDom(() => {
      const el = new FakeElement();
      el.classes.add(DROP_TARGET_CLASS);
      unmarkDropTarget(dropTargetOf(el, null));
      assert.equal(
        el.classes.has(DROP_TARGET_CLASS),
        false,
        'The highlight must be removed when leaving the drop point',
      );
    });
  });
});
