import EvalSourceMapDevToolPlugin from 'next/dist/build/webpack/plugins/eval-source-map-dev-tool-plugin';

export function e2eWebpackPlugins<T>(plugins: T[], dev: boolean, enabled: boolean): T[] {
  if (!dev || !enabled) return plugins;
  // Next installs this instead of config.devtool. Its inline maps duplicate route
  // sources during E2E warmup; retain every other plugin, including instrumentation.
  // The compiler regression checks this version-coupled Next boundary on upgrades.
  const retained = plugins.filter((plugin) => !(plugin instanceof EvalSourceMapDevToolPlugin));
  if (retained.length !== plugins.length - 1) {
    throw new Error(
      'Next development source-map plugin changed; review the E2E compiler configuration.',
    );
  }
  return retained;
}
