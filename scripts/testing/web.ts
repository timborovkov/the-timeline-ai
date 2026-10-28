import { readFileSync } from 'node:fs';
import { plugin } from 'bun';

// CSS modules expose only class names in component tests. Read the actual
// stylesheet so missing/renamed classes still fail rather than using a proxy.
plugin({
  name: 'test-css-modules',
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, ({ path }) => {
      const source = readFileSync(path, 'utf8');
      const names = [...source.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]!);
      return {
        loader: 'js',
        contents: `export default ${JSON.stringify(Object.fromEntries(names.map((name) => [name, name])))};`,
      };
    });
  },
});
