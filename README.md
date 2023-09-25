# U27N Webpack Plugin
This is a webpack plugin that integrates the u27n toolchain into webpack as an alternative for the u27n cli.

## Content
+ [Setup](#setup)
+ [Dynamic Imports](#dynamic-imports)
+ [Environments](#environments)
  + [NodeJS](#nodejs)
  + [Custom Environments](#custom-environments)
+ [Multiple Controllers](#multiple-controllers)
+ [Caching](#caching)
+ [Troubleshooting](#troubleshooting)
+ [Internals](#internals)
+ [Compatibility](#compatibility)

<br>



# Setup
Add the u27n plugin to your webpack config:
```js
const { U27nPlugin } = require("@u27n/webpack");

module.exports = {
  plugins: [
    new U27nPlugin({
      // Example options:
      config: "./u27n.json",
    })
  ]
}
```
+ **config** `<string | string[]>` - Filename of one or more u27n configs.
  + This can be relative to the webpack context.
  + Default is `"./u27n.json"`
+ **env** `<string>` - Absolute path to the environment implementation module.
+ **output** `<string>` - The filename template to output compiled locale data.
  + The following placeholders are supported:
    + `"[hash]"` - The content hash.
    + `"[chunk]"` - The webpack chunk id.
    + `"[locale]"` - The locale code.
  + Defaults are:
    + `"locale/[hash].json"` in production mode
    + `"locale/[chunk]-[locale]"` in development mode
+ **modify** and **delay** - Same as the CLI's `--modify` and `--delay` arguments.

<br>



At runtime, the u27n controller has to be globally registered:
```js
import { U27N, Context, defaultLocaleFactory } from "@u27n/core/runtime";
import { registerController } from "@u27n/webpack/runtime";

const u27n = new U27N({
  localeFactory: defaultLocaleFactory,
});

registerController(u27n);

// After registration, the locale may be set:
await u27n.setLocaleAuto(["en", "de"]);

const context = new Context(u27n, "example", "en");

export const t = context.t;
```
Note, that other u27n clients can be removed.

<br>



# Dynamic Imports
When dynamic imports are used, locale data is split up into chunks.

When invoking a dynamic import, locale data for the imported modules is loaded automatically:
```ts
// index.ts
(await import("./page")).show();

// page.ts
export function show() {
  console.log(t("Hello World!"));
}
```

When switching locales, locale data is loaded for all previously imported modules. When a dynamically imported module is no longer needed, you should prevent loading locale data for that module until it is imported again:
```ts
import { forgetModule } from "@u27n/webpack/runtime";

const page = await import("./page");
// Do something with page...

// When page is no longer needed:
forgetModule(page);
```

<br>



# Environments
By default, `fetch` is used to request locale chunks relative to webpack's public path:
```js
new U27nPlugin({
  // This is the default environment:
  env: U27nPlugin.ENV_FETCH,
})
```

## NodeJS
The `ENV_NODE` environment uses `node:fs/promises` to read locale chunks from disk:
```js
new U27nPlugin({
  env: U27nPlugin.ENV_NODE,
})
```

## Custom Environments
If further customization is needed, you can implement your own environment module as specified in [src/runtime/env/module-proxy.d.ts](./src/runtime/env/module-proxy.d.ts).
```js
// /u27n-environment.js
export const env = {
  async fetchLocaleChunk(name) {
    const response = await fetch(__webpack_public_path__ + name);
    if (response.ok) {
      return response.json();
    }
    throw new Error(`Failed to fetch locale chunk: ${JSON.stringify(name)}`);
  },
};
```

```js
new U27nPlugin({
  env: require.resolve("./u27n-environment.js"),
})
```

<br>



# Multiple Controllers
To implement things like server side rendering, multiple controllers can be registered:
```js
function createLocale(locale) {
  const u27n = new U27N({
    localeFactory: defaultLocaleFactory,
  });

  registerController(u27n);
  await u27n.setLocale(locale);

  return new Context(u27n, "example", "en").t;
}

const en = await createLocale("en");
const de = await createLocale("de");
```

<br>



# Caching
Loaded locale chunks are cached forever by default. In development, it can be useful to clear this cache manually to allow loading updated locale data:
```js
import { clearCache } from "@u27n/webpack/runtime";

if (u27n.locale) {
  clearCache();
  await u27n.setLocale(u27n.locale.code);
}
```

<br>



# Troubleshooting
+ Loading locale data causes errors:
  + If `ENV_FETCH` is used, check that locale data from the output directory is available under webpack's public path.
  + If `ENV_NODE` is used, check that the runtime is bundled in a chunk file that is located in the root output directory.
    + If this is not possible for some reason, consider implementing your own environment module that compensates for custom paths.
+ Some parts of the application are not translated or changing locales throws errors:
  + Check the compiler output for diagnostics. Outdated translations are not included by default.
  + Check if the error is caused by custom [environment](#environments) implementation.
  + Temporarily disable hot module reloading.
  + Check your `package-lock.json` file if there are multiple `@u27n/webpack` packages installed.
    + In this case, webpack may bundle multiple conflicting runtimes which is not supported.
    + To resolve this issue, use npm overrides to use a single version of `@u27n/webpack`.
+ ReferenceError: _u27nw_i is not defined:
  + This happens if the u27n webpack runtime is not loaded before any dynamic imports are invoked.
  + To avoid this issue, make sure, that the `@u27n/webpack/runtime` module is imported in an entry chunk.

<br>



# Internals
**Note**, that internals are only documented for transparency and are not considered stable API.

This plugin uses global variables prefixed with `"_u27nw_"`.<br>
For more information in globals, see [src/types/runtime.d.ts](./src/types/runtime.d.ts).

<br />



# Compatibility
The table below shows what [core](https://www.npmjs.com/package/@u27n/core) versions are supported by this package.

| @u27n/webpack | @u27n/core |
|-|-|-|
| 1.x | 3.x |
| 0.x | 2.x |
