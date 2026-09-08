import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** File order matters: 01-read must see the untouched seed before 02-write appends to it. */
class AlphabeticalSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 180000,
    // The global setup seeds and boots the app once; the tool tests share that instance and run in file order.
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false, sequencer: AlphabeticalSequencer }
  }
});
