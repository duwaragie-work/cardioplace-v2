import nextJest from 'next/jest.js'

// next/jest wires SWC transform + tsconfig path aliases + env so component
// tests run the same way the app builds. UI unit layer (RTL); E2E stays in qa/.
const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Workspace package — point at the built dist (jest's resolver doesn't
    // follow the package's exports map through the workspace symlink). Run
    // `npm run build:shared` if @cardioplace/shared changes.
    '^@cardioplace/shared$': '<rootDir>/../shared/dist/index.js',
  },
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
}

export default createJestConfig(config)
