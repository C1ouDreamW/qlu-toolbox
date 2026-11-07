// Extract workflow PowerShell for syntax parsing only; never execute it.
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import yaml from 'js-yaml'

const directory = fileURLToPath(new URL('../.github/workflows/', import.meta.url))
const scripts = []
for (const file of (await readdir(directory)).filter(name => /\.ya?ml$/.test(name)).sort()) {
  const workflow = yaml.load(await readFile(join(directory, file), 'utf8'))
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    const windows = typeof job['runs-on'] === 'string' && job['runs-on'].startsWith('windows-')
    for (const [index, step] of (job.steps ?? []).entries()) {
      const shell = step.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell ?? (windows ? 'pwsh' : '')
      if (typeof step.run === 'string' && /^(?:pwsh|powershell)(?:\s|$)/.test(shell)) scripts.push({ file, job: name, step: step.name ?? String(index), run: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, '__GITHUB_EXPRESSION__') })
    }
  }
}
console.log(JSON.stringify(scripts))
