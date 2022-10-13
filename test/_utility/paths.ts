import { join, resolve } from "node:path";

export const packageRoot = resolve(__dirname, "../../..");
export const testRoot = join(packageRoot, "test_out/test");
export const testSrcRoot = join(packageRoot, "test_out/src");
export const testDataRoot = resolve(packageRoot, "test_data");

export const nodeBin = process.execPath;
export const webpackCli = join(packageRoot, "node_modules/webpack-cli/bin/cli.js");
export const u27nCli = join(packageRoot, "node_modules/@u27n/core/dist/cjs/cli.js");
