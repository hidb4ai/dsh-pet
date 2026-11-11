// tsdown configuration (imitation of the construction method of the official DSH client plugin: src → lib product)
// Note: lib/client.js produced by the DSH browser plugin must be
// window.__ModuleLoader__.load ({ id , factory }) single file form; react / react/jsx-runtime / @deepseek - ai /* Keep
// external require (not packaged).
//
// Three configurations:
// 1) Browser side (client → lib/client.js) - Same as running in DSH, @deepseek - ai /* all externalized (those
// packages are provided by DSH host); the product additionally packages a layer of IIFE, for the reason, see the
// explanation in this configuration.
// 2) host side (index → lib/index.js) - keep ESM, Loader from DSH to import.
// 3) Standalone mode entry point (standalone → lib/standalone.js) - it needs to run in an environment without DSH
// (the plugin is loaded into profile and directly `node node_modules/dsh-pet/lib/standalone.js` ), and the module
// diagram of the host half has three static imports, which are only in DSH The package that exists in cannot be parsed
// there. Therefore use alias to replace them with local aliases (src/standalone/shims /*): the aliases only do
// "transpose the plugin's own implementation of the same caliber" or "explicitly downgrade" without any
// generation/network logic (see each file header for details). The remaining @deepseek - ai /* are still processed
// externally (negative assertion) to avoid accidentally entering the DSH code into the product.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

/** The directory where this configuration file is located (= package root) */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)));

/** The absolute path used to replace the package name (the absolute path of rolldown and alias is the most stable) */
const shim = (name) => join(packageRoot, 'src', 'standalone', 'shims', `${name}.ts`);

/** Compilation caliber shared by two configurations */
const shared = {
  format: ['esm'],
  platform: 'node',
  target: 'es2020',
  dts: false,
  outDir: 'lib',
  clean: false,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      client: 'src/client/index.ts',
    },
    external: [/^@deepseek-ai\//, /^@electron\//, /^node:/],
    // The browser side must be **repeatedly executed**: DSH loads lib/client.js as a classic script, and after bundle
    // is rebuilt (HMR is replaced by rev) or combo is requested to be retried, the same file will be executed again on
    // the same page. The top level const/let/function of the classic script falls in the global lexical scope of the
    // page. The second parsing is directly SyntaxError ( Identifier ' PET_DISPLAYS ' has already been declared ).
    // entry activation fails → desktop pet overlay It is not registered with the settings page slot and can only be
    // restored by refreshing. Therefore, the entire product includes a layer of IIFE, allowing all module body
    // declarations to remain within the function scope; the leading ';' offsets the ASI ambiguity when combo is
    // spliced (multiple plugins bundle are connected into one script).
    outputOptions: { banner: ';(()=>{', footer: '})();' },
  },
  {
    ...shared,
    // The host side holds ESM (Loader from DSH to import) and must not include IIFE. The lower limit of Node is higher
    // than ES2022; the class field is retained to avoid the introduction of undeclared running auxiliary packages
    // during downgrade.
    target: 'es2022',
    entry: {
      index: 'src/host/index.ts',
    },
    external: [/^@deepseek-ai\//, /^@electron\//, /^node:/],
  },
  {
    ...shared,
    // Standalone mode only runs on Node ≥ 22.12 (engines of package.json has been declared), so the target can be
    // es2022: The es2020 target will downgrade class field to `_defineProperty(...)` , thereby dragging
    // `@oxc-project/runtime` into a naked line import - That package is not included in this package's dependencies.
    // Once installed, users will get ERR_MODULE_NOT_FOUND when they run it. The class field is retained like the DSH
    // host entry point; the browser entry point still uses es2020.
    target: 'es2022',
    entry: {
      standalone: 'src/standalone/cli.ts',
    },
    // tsdown externalizes all dependencies/peerDependencies by default (the three DSH exclusive packages in this
    // package are exactly peerDependencies), so here you must first noExternal to pull them back into the package
    // diagram, and the following alias will take effect; otherwise, bare import will be left in the product, in an
    // environment without DSH ERR_MODULE_NOT_FOUND.
    noExternal: [/^@deepseek-ai\/(?:dsh-home-paths|dsh-credentials|dsh-llm)$/],
    // Except for the three substitutes, the rest @deepseek - ai /* are still regarded as provided by the host (negative assertion)
    external: [/^@electron\//, /^node:/, /^@deepseek-ai\/(?!dsh-home-paths$|dsh-credentials$|dsh-llm$)/],
    alias: {
      '@deepseek-ai/dsh-home-paths': shim('dsh-home-paths'),
      '@deepseek-ai/dsh-credentials': shim('dsh-credentials'),
      '@deepseek-ai/dsh-llm': shim('dsh-llm'),
    },
  },
  {
    ...shared,
    // Independent application entry point (`lib/app.js`): A Electron process runs "native service + plugin host half
    // + desktop window". The caliber is exactly the same as that of standalone (the three DSH proprietary packages are
    // also replaced with substitutes), only the external `electron` is provided - it is provided by Electron's own
    // module loader, and it will explode when entering the package.
    target: 'es2022',
    entry: {
      app: 'src/app/main.ts',
    },
    // zod is packaged: The application product must be "not dependent on node_modules", and the configuration
    // verification must be used every time it is started. openai / @anthropic - ai/sdk must also be packaged: they
    // consist of src/standalone/ai-transport.ts top-level static import , while electron-builder 's files whitelist
    // does not have node_modules ; when left as external bare import , the product will be unpacked once it leaves the
    // project directory (e.g. unzipped to Downloads ) ERR_MODULE_NOT_FOUND.
    // @electron / get and @electron - internal/extract-zip remain external - they are only used when "Download
    // Electron"
    // Dynamic parsing, application patterns never go that route (see import comments for src/host/helper-process.ts).
    noExternal: [
      /^@deepseek-ai\/(?:dsh-home-paths|dsh-credentials|dsh-llm)$/,
      /^zod$/,
      /^openai$/,
      /^@anthropic-ai\/sdk$/,
      // Speech synthesis: import at runtime, but the application product does not have node_modules and must be inline (with its ws).
      /^@andresaya\/edge-tts$/,
    ],
    external: ['electron', /^@electron\//, /^node:/, /^@deepseek-ai\/(?!dsh-home-paths$|dsh-credentials$|dsh-llm$)/],
    alias: {
      '@deepseek-ai/dsh-home-paths': shim('dsh-home-paths'),
      '@deepseek-ai/dsh-credentials': shim('dsh-credentials'),
      '@deepseek-ai/dsh-llm': shim('dsh-llm'),
    },
  },
  {
    ...shared,
    // Dialog panel (lib/chat-panel.js) in the standalone mode settings page: When running in the browser, there is
    // neither DSH injection nor node_modules, so react / react-dom must be imported into the product-this is exactly
    // the opposite of client (which is provided by the host). platform is overwritten into browser, otherwise tsdown
    // will be parsed according to node caliber and leave node: built-in dependency.
    platform: 'browser',
    target: 'es2020',
    entry: {
      'chat-panel': 'src/standalone/settings-page/chat-mount.ts',
    },
    noExternal: [/^react(\/|$)/, /^react-dom(\/|$)/],
    external: [/^node:/],
    // Same as client: refreshing the settings page will rerun the script, including a layer of IIFE to prevent the top-level statement from triggering SyntaxError repeatedly.
    outputOptions: { banner: ';(()=>{', footer: '})();' },
  },
]);
