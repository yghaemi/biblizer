import esbuild from 'esbuild'
import { readFileSync } from 'fs'

const watch = process.argv.includes('--watch')

// Parse .env into esbuild define entries so process.env.VAR is replaced at build time
function loadEnvDefines(path = '.env') {
  const defines = {}
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/)
      if (match) {
        defines[`process.env.${match[1]}`] = JSON.stringify(match[2])
      }
    }
  } catch { /* .env is optional */ }
  return defines
}

const envDefines = loadEnvDefines()

const common = {
  bundle: true,
  target: 'es2020',
  platform: 'browser',
  sourcemap: process.argv.includes('--dev'),
  loader: { '.xml': 'text', '.css': 'text' },  // import as plain strings, injected at runtime
  define: envDefines,
}

// The loader must not bundle the engine: swap src/engineLoader.js for a
// runtime import() of the engine file that sits next to the loader bundle.
/** @param {string} engineFile  e.g. 'engine.min.js' */
const engineImportPlugin = (engineFile) => ({
  name: 'engine-import',
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]engineLoader\.js$/ }, () => ({
      loader: 'js',
      contents: `export const loadEngine = (scriptUrl) => import(new URL(${JSON.stringify(engineFile)}, scriptUrl).href);`,
    }))
  },
})

// [loader outfile, engine outfile, minify] — script.js ↔ engine.js, script.min.js ↔ engine.min.js
const variants = [
  ['dist/script.js', 'dist/engine.js', false],
  ['dist/script.min.js', 'dist/engine.min.js', true],
]

const configs = variants.flatMap(([loaderOut, engineOut, minify]) => [
  {
    ...common,
    entryPoints: ['src/script.js'],
    outfile: loaderOut,
    format: 'iife',
    minify,
    plugins: [engineImportPlugin(engineOut.split('/').pop())],
  },
  { ...common, entryPoints: ['src/engine.js'], outfile: engineOut, format: 'esm', minify },
])

if (watch) {
  for (const options of configs) await (await esbuild.context(options)).watch()
  console.log('Watching for changes...')
} else {
  await Promise.all(configs.map((options) => esbuild.build(options)))
  console.log('Built → dist/script.js, dist/script.min.js, dist/engine.js, dist/engine.min.js')
}
