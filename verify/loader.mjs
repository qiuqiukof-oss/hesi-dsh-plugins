// ESM resolve 钩子：把适配器运行期 import 的 '@deepseek-ai/dsh-llm' 映射到本地桩，
// 使「真实适配器代码」可在离线 Node 下被加载执行（无需安装整个 DSH monorepo）。
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve as pathResolve } from 'node:path'
import { register } from 'node:module'

const ROOT = dirname(fileURLToPath(import.meta.url))
const MAP = {
  '@deepseek-ai/dsh-llm': pathToFileURL(pathResolve(ROOT, 'stubs/dsh-llm.mjs')).href,
}

// 用 --import 加载本模块时，需主动把自身注册为 resolve 钩子。
register(import.meta.url, import.meta.url)

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true }
  return next(specifier, context)
}
