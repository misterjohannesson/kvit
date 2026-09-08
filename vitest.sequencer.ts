import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Run API test files in filename order so `tests/api/00-finance.test.ts` sees the seed
 * data before other files add invoices and expenses to the shared database.
 */
export default class AlphabeticalSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}
