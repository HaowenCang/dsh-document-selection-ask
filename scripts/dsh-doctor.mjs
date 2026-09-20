/**
 * Report whether this project's DSH contract dependencies match the DSH
 * installation this machine actually runs.
 *
 * This script is the **environment half** of the Task 14 compatibility gate. It
 * deliberately does not re-implement it: `scripts/check-dsh-contracts.mjs` owns
 * the contract-pin comparison, the runtime discovery and the compile step, and
 * this file reports the same state with the `dsh-doctor:` prefix and the
 * `--runtime` semantics the repository documented before Task 14. Two scripts
 * that each decided independently when a pin disagreed with an installation is
 * precisely the "two conflicting truths" a doctrine of one owner exists to
 * prevent, so the decision is imported rather than restated.
 *
 * The difference between the two commands is the compile step and the default.
 * `pnpm dsh:doctor` answers "is this machine's DSH the one the pins describe?"
 * and treats an absent installation as a note, because the project deliberately
 * does not require the machine's DSH to be present for `pnpm install`,
 * `pnpm typecheck` or `pnpm build`. `pnpm check:dsh-contracts` is the Task 14
 * gate: it requires the installation to be found, and it compiles the contract
 * probes against the installed declarations before reporting PASS.
 *
 * Both only read. Neither writes inside the project, queries a registry, or
 * touches the DSH installation.
 *
 * Run it directly (`pnpm dsh:doctor`), or with `--runtime` to make an absent
 * installation a failure rather than a note.
 *
 * Locations are discovered, never hard-coded; `check-dsh-contracts.mjs`
 * documents the three routes and their precedence. Because the decision is
 * imported rather than restated, the override semantics come with it: with
 * `DSH_INSTALL_NODE_MODULES` set, this script reports the same discovery source
 * and the same "the `PATH` CLI was not probed" state the checker reports, and it
 * cannot reach a different verdict about an ambient installation.
 */

import { inspectContractEnvironment } from './check-dsh-contracts.mjs'

const requireRuntime = process.argv.includes('--runtime')

const state = inspectContractEnvironment({ requireRuntime })

console.log(`dsh-doctor: installed DSH = ${state.runtime?.version ?? 'not found'}`)
if (state.runtime !== null) console.log(`dsh-doctor: DSH scope = ${state.runtime.root}`)
console.log(`dsh-doctor: runtime discovery = ${state.source}`)
if (state.exclusive === true) {
  console.log('dsh-doctor: PATH CLI report = NOT PROBED (explicit override)')
}
console.log(`dsh-doctor: contract release pin = ${state.releasePin ?? 'inconsistent'}`)
console.log(
  'dsh-doctor: contract packages = ' +
    [...(state.pins ?? [])].map(([name, { range }]) => `@deepseek-ai/${name}@${range}`).join(', '),
)
if (state.notes.length > 0) console.log(`dsh-doctor: notes\n${state.notes.join('\n')}`)

if (state.problems.length > 0) {
  console.error(`dsh-doctor: contract environment is inconsistent:\n${state.problems.join('\n')}`)
  process.exitCode = 1
} else {
  console.log('dsh-doctor: contract environment is consistent')
}
