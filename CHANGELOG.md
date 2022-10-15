# Changelog

## 0.3.3
+ Fix edge case where data is not loaded when dynamic imports are invoked while changing locales.
+ Automatically embed external locales using u27n manifests.

## 0.3.2
+ Add noop environment module in case code is loaded in a non-webpack runtime.

## 0.3.1
+ Fix assets processing conflict with webpack's BannerPlugin.

## 0.3.0
+ Complete re-implementation:
  + Supports loading locale chunks via fetch, node fs or a custom implementation.
  + Supports concurrent runtime controllers for things like server side rendering.
  + Supports multiple u27n projects.

## 0.2.0
+ Use webpack API provided through the compiler instance.
+ Add diagnostics logging.
+ Use webpack chunk ids instead of internal ids.
+ Prevent manifest from beeing added to non javascript chunk files.
