/**
 * The only outlet for the settings page dictionary: summary of namespaces, key types and all languages. zh is the true
 * source of the key set. Each language is declared as `Record<Key, string>` . If a key is missed, an error will be
 * reported during type checking. Starting from host 0.2.2, eight languages zh / en / ja / es / fr / de / ru / pt are
 * built-in. For the remaining languages, press `en` to fall back key by key.
 * @module dsh-pet/src/client/settings/locales
 */
import { de } from './de.ts';
import { en } from './en.ts';
import { es } from './es.ts';
import { fr } from './fr.ts';
import { ja } from './ja.ts';
import { pt } from './pt.ts';
import { ru } from './ru.ts';
import { zh } from './zh.ts';

/** Dictionary namespace. */
export const NS = 'pet.config';

/** Dictionaries compiled by host language id, the whole package is given to `ctx.locale.register`. */
export const dicts = { zh, en, ja, es, fr, de, ru, pt };

export { zh } from './zh.ts';
export type { Key } from './zh.ts';
