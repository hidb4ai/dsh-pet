/**
 * Copy translation for standalone mode settings page: replace placeholders by the same `{name}` rules as host.
 *
 * `ctx.locale.bind(NS)` provides translation on the host side. There is no locale service in the independent
 * environment. Here, a self-built dictionary is used in the package; the page is fixed in Chinese (see `lang="zh-CN"`
 * of chrome.ts), and the dictionary is `zh` .
 * @module dsh-pet/src/standalone/settings-page/translate
 */

/**
 * Create a translation function.
 *
 * @param dict - a dictionary of keys to copy; the key set is determined by the incoming dictionary. When the caller
 * passes `zh` , it is the complete key set of the panel.
 * @returns is a translation function that retrieves text by pressing a key; it returns the default parameters as they
 * are, and replaces missing parameters with empty strings.
 */
export function createTranslator<K extends string>(
  dict: Readonly<Record<K, string>>,
): (key: K, params?: Record<string, unknown>) => string {
  return (key, params) => {
    const text = dict[key] ?? key;
    if (params === undefined) return text;
    return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
  };
}
