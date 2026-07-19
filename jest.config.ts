import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // never scan sibling git worktrees (Agent-tool isolation lives under
  // .claude/worktrees/) — their tests belong to their own branch's run, not ours.
  // `fixtures/` holds shared test DATA, not suites: without this jest picks the
  // files up and fails them for containing no tests.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/', '/__tests__/fixtures/'],
  // Jest defaults to cores-1 (7 here); that many jsdom+Next workers exhaust
  // memory — the suite has been SIGKILLed outright (exit 137), and short of
  // that, suites fail at a different line each run while passing in isolation,
  // which reads as a real bug and isn't. The pre-push hook runs this whole
  // suite, so a flaky pool means spuriously aborted pushes. Don't raise this:
  // 2 is green, and with sibling worktrees each running a dev server it is no
  // slower in practice than the default that was thrashing.
  maxWorkers: 2,
}

export default createJestConfig(config)
