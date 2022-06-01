# U27N Webpack Plugin
This is a webpack plugin that can be used instead of the U27N command line interface that supports
locale data chunk splitting, tree shaking and automatic detection of locale data for external npm packages.

**Note**, that work is in progress and things might not work as expected for all "0.x" versions.

## Setup
```bash
npm install --save-dev @u27n/webpack
```

Add the plugin to your webpack config:
```js
// webpack.config.js

const { U27nPlugin } = require("@u27n/webpack");

{
  plugins: [
    new U27nPlugin({
      // All options are optional with the following defaults:

      // Filename of the U27N config.
      // (This can be relative to the webpack context or absolute)
      config: "./u27n.json",

      // Enable or disable updating source code.
      // This is the same as the CLI modify argument.
      modify: true | false,

      // Time to wait in milliseconds after changes on disk are detected.
      // This is the same as the CLI delay argument.
      delay: 100,

      // The filename to output bundled locale data.
      // The following placeholders are supported:
      //   [hash]     Content hash
      //   [chunk]    U27N internal chunk id
      //   [locale]   Locale code
      //
      // Default is "locale/[hash].json" in production, otherwise "locale/[locale]-[chunk].json".
      output: "locale/[locale]-[chunk].json",
    })
  ],
}
```

Use the following runtime setup:
```js
import { U27N, defaultLocaleFactory } from "@u27n/core/runtime";
import { setController } from "@u27n/webpack/runtime";

const u27n = new U27N({
  localeFactory: defaultLocaleFactory,

  // Note, that no clients need to be configured here.
});

// Register the global controller:
setController(u27n);

// When your application loads, detect and load locale data:
await u27n.setLocaleAuto(["en", "de"]);
```
