# Browser and script regression checks

English · [简体中文](README.zh.md)

Run from the inner `dsh-pet/` package:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium
pnpm test:ui
```

On Linux CI, use `pnpm exec playwright install --with-deps chromium` if system libraries are missing.

The settings tests render real React in Chromium and intercept local configuration/model APIs. They cover loading, failed requests, retry, defaults, saving, and narrow English/Chinese layouts. They use temporary local services and do not read or modify your personal DSH configuration. Run them separately from `pnpm test`; installing the pet does not download a test browser.

Set `DSH_PET_UI_ARTIFACTS` to a directory outside the checkout when saving layout screenshots. Native Electron windows, OS click-through and display scaling need separate runtime checks. See the [development guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/reference/development.md).
