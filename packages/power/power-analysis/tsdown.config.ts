import { defineConfig } from 'tsdown'

/**
 * 根入口与 invariant 都依赖 schema；分别打包可将 schema 内联，避免发布白名单
 * 漏掉多入口构建生成的哈希分块。
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
