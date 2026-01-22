/**
 * BDD Helpers - Gherkin-like syntax for Vitest
 * Provides feature, scenario, given, when, then, and syntax
 */

import { describe, it, beforeEach, type TestFunction } from 'vitest';

type StepFn = () => void | Promise<void>;

interface ScenarioContext {
  steps: Array<{ type: string; description: string; fn: StepFn }>;
  beforeEachFn?: StepFn;
}

let currentScenario: ScenarioContext | null = null;

/**
 * Define a feature (test suite)
 */
export const feature = (description: string, fn: () => void): void => {
  describe(`Feature: ${description}`, fn);
};

/**
 * Define a scenario (test case)
 * Collects all Given/When/Then steps and executes them in order
 */
export const scenario = (description: string, fn: () => void): void => {
  it(`Scenario: ${description}`, async () => {
    currentScenario = { steps: [] };

    // Collect all steps by running the scenario function
    fn();

    // Execute all collected steps in order
    for (const step of currentScenario.steps) {
      await step.fn();
    }

    currentScenario = null;
  });
};

/**
 * Define a background that runs before each scenario in a feature
 */
export const background = (fn: () => void): void => {
  beforeEach(async () => {
    currentScenario = { steps: [] };
    fn();
    for (const step of currentScenario.steps) {
      await step.fn();
    }
    currentScenario = null;
  });
};

/**
 * Given step - setup preconditions
 */
export const given = (description: string, fn: StepFn): void => {
  if (currentScenario) {
    currentScenario.steps.push({ type: 'Given', description, fn });
  }
};

/**
 * When step - perform action
 */
export const when = (description: string, fn: StepFn): void => {
  if (currentScenario) {
    currentScenario.steps.push({ type: 'When', description, fn });
  }
};

/**
 * Then step - verify outcome
 */
export const then = (description: string, fn: StepFn): void => {
  if (currentScenario) {
    currentScenario.steps.push({ type: 'Then', description, fn });
  }
};

/**
 * And step - continuation of previous step type
 */
export const and = (description: string, fn: StepFn): void => {
  if (currentScenario && currentScenario.steps.length > 0) {
    const lastType = currentScenario.steps[currentScenario.steps.length - 1].type;
    currentScenario.steps.push({ type: `And (${lastType})`, description, fn });
  }
};

/**
 * But step - negative continuation
 */
export const but = (description: string, fn: StepFn): void => {
  if (currentScenario && currentScenario.steps.length > 0) {
    const lastType = currentScenario.steps[currentScenario.steps.length - 1].type;
    currentScenario.steps.push({ type: `But (${lastType})`, description, fn });
  }
};

/**
 * Scenario outline for parameterized tests
 */
export const scenarioOutline = <T extends Record<string, unknown>>(
  description: string,
  examples: T[],
  fn: (example: T) => void
): void => {
  describe(`Scenario Outline: ${description}`, () => {
    examples.forEach((example, index) => {
      const exampleDesc = Object.entries(example)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');

      it(`Example ${index + 1}: ${exampleDesc}`, async () => {
        currentScenario = { steps: [] };
        fn(example);
        for (const step of currentScenario.steps) {
          await step.fn();
        }
        currentScenario = null;
      });
    });
  });
};

export default {
  feature,
  scenario,
  scenarioOutline,
  background,
  given,
  when,
  then,
  and,
  but,
};
