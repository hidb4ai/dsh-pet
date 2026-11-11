/**
 * Mount prefix contract: sub-path deployment must follow `document.baseURI` , and the root path, desktop and host
 * values must remain unchanged from byte to byte. For the background of the phenomenon, see issue #242 - the absolute
 * path `/dsh-pet-7340/…` will bypass the anti-generation prefix and go directly to the site root.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ROUTE_PATH, ROUTE_SEGMENT, mountPrefixOf, routePathOf } from './constants.ts';

describe('mountPrefixOf', () => {
  test('No document base address: empty prefix returned', () => {
    assert.equal(mountPrefixOf(undefined), '');
    assert.equal(mountPrefixOf(''), '');
  });

  test('Root path deployment: get the empty directory part', () => {
    assert.equal(mountPrefixOf('http://127.0.0.1:2298/'), '');
  });

  test('Subpath deployment with port: return to the mount directory and remove the trailing slash', () => {
    assert.equal(
      mountPrefixOf('http://192.0.2.10:5666/app/DeepSeek-Harness/fngateway/'),
      '/app/DeepSeek-Harness/fngateway',
    );
  });

  test('Missing or duplicate trailing slash: normalize to the same prefix', () => {
    assert.equal(mountPrefixOf('https://h.example.com/dsh'), '/dsh');
    assert.equal(mountPrefixOf('https://h.example.com/dsh/'), '/dsh');
    assert.equal(mountPrefixOf('https://h.example.com/dsh///'), '/dsh');
  });

  test('Address without path part: empty prefix', () => {
    assert.equal(mountPrefixOf('http://127.0.0.1:2298'), '');
  });

  test('Query strings and fragments do not enter the prefix', () => {
    assert.equal(mountPrefixOf('https://h.example.com/dsh/?a=1#b'), '/dsh');
  });

  test('Non-http (s) protocol: empty prefix', () => {
    assert.equal(
      mountPrefixOf('file:///C:/Users/x/index.html'),
      '',
      'The desktop local page does not have a mount prefix',
    );
    assert.equal(mountPrefixOf('data:text/html,<p></p>'), '');
    assert.equal(mountPrefixOf('chrome-extension://abc/index.html'), '');
  });

  test('Invalid address: empty prefix and no exception thrown', () => {
    assert.equal(mountPrefixOf('not a url'), '');
  });

  test('The prefix contains non-ASCII: encoded according to the URL rule percent sign', () => {
    // The gateway must decode and then match the prefix; the request sent by the browser is in the encoded form (this is the case for issue #242 and U +2011 with characters).
    assert.equal(mountPrefixOf('http://h/app/DeepSeek\u2011Harness/'), '/app/DeepSeek%E2%80%91Harness');
  });
});

describe('routePathOf', () => {
  test('No prefix environment: equal to pure route segment', () => {
    assert.equal(routePathOf(undefined), ROUTE_SEGMENT);
    assert.equal(routePathOf('http://127.0.0.1:2298/'), ROUTE_SEGMENT);
    assert.equal(routePathOf('file:///C:/Users/x/index.html'), ROUTE_SEGMENT);
  });

  test('Sub-path deployment: route segment is hung after the prefix', () => {
    assert.equal(
      routePathOf('http://192.0.2.10:5666/app/DeepSeek-Harness/fngateway/'),
      '/app/DeepSeek-Harness/fngateway/dsh-pet-7340',
    );
    assert.equal(routePathOf('https://h.example.com/dsh/'), '/dsh/dsh-pet-7340');
  });
});

describe('ROUTE_PATH', () => {
  test('Node environment does not have document: the module level value is consistent with the route segment', () => {
    assert.equal(
      ROUTE_PATH,
      ROUTE_SEGMENT,
      'The host and desktop Helper main process side and unit test must be consistent bytes bytes before the change.',
    );
  });
});
