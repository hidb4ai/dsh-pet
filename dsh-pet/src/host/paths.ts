/**
 * In-package path constant: the only source of package root and asset root, shared by host assembly and route layer.
 *
 * It only does path calculation, does not read the disk, and does not determine the existence; whether the parsed
 * directory is available is determined by the caller. Must always be true: all asset paths are derived from
 * PACKAGE_ROOT and must not be derived from `new URL('..', import.meta.url)` elsewhere.
 * @module dsh-pet/src/host/paths
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This package directory: host build output is located at lib/, and its upper level is the package root. */
export const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** assets root in package */
export const PACKAGE_ROOT_ASSETS = join(PACKAGE_ROOT, 'assets');

/** Emoji package directory in the package (the last link of the meme pool: assets/memes/<name>. png) */
export const PACKAGE_MEMES_DIR = join(PACKAGE_ROOT_ASSETS, 'memes');
