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
  // .claude/worktrees/) — their tests belong to their own branch's run, not ours
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
}

export default createJestConfig(config)
