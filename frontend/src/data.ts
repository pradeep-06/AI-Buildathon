import type { AgentStage } from './types';

export const AGENT_STAGES: AgentStage[] = [
  {
    id: 'intent',
    name: 'Intent agent',
    role: 'Reads the prompt',
    detail: 'Turns plain language into a flow: pages, actions, data, and the outcome to assert.',
  },
  {
    id: 'locator',
    name: 'Locator agent',
    role: 'Chooses selectors',
    detail: 'Prefers getByRole, getByLabel, and getByTestId so scripts survive layout changes.',
  },
  {
    id: 'spec',
    name: 'Spec agent',
    role: 'Writes Playwright TypeScript',
    detail: 'Builds a page object and a spec with test.step, typed locators, and web-first expects.',
  },
  {
    id: 'review',
    name: 'Review agent',
    role: 'Checks the script',
    detail: 'Flags fixed sleeps, missing assertions, untyped code, and secrets written into the file.',
  },
];

export const PRACTICES = [
  {
    title: 'Page objects stay thin',
    body: 'One class per screen. Locators are readonly fields. Actions are methods. Assertions stay in the spec so the page object does not hide failures.',
  },
  {
    title: 'Locators a user would recognize',
    body: 'Reach for getByRole, getByLabel, and getByPlaceholder before CSS. Agree data-testid with the app team when the accessible name is unstable.',
  },
  {
    title: 'Web-first assertions',
    body: 'await expect(locator).toBeVisible() retries. waitForTimeout does not. The review agent treats a fixed sleep as a failure.',
  },
  {
    title: 'Arrange, act, assert',
    body: 'Each test owns its data. Wrap the act phase in test.step so the HTML report reads like the original prompt.',
  },
  {
    title: 'Secrets stay outside the repo',
    body: 'Read users, passwords, and base URLs from the environment. The generated spec uses process.env with an obvious local fallback for demos only.',
  },
  {
    title: 'Traces on retry',
    body: 'playwright.config.ts enables trace, screenshot, and video on failure. Debugging a red build should not require re-running it by hand.',
  },
  {
    title: 'Type the boundary',
    body: 'Import Page and Locator types. Avoid any. A prompt update should still compile under strict TypeScript.',
  },
  {
    title: 'Parallel by default',
    body: 'Tests do not share a mutable account or a single cart. fullyParallel stays on so the suite can grow without a hidden order.',
  },
];

export const SAMPLE_PROMPTS = [
  'Open https://www.saucedemo.com, sign in as standard_user with password secret_sauce, add Sauce Labs Backpack to the cart, open the cart, and verify the backpack is listed.',
  'Open https://demo.playwright.dev/todomvc, add a todo called "Ship the buildathon demo", mark it complete, and verify one item is left in the list.',
  'Open https://www.saucedemo.com, sign in as standard_user with password secret_sauce, and verify the products page shows the inventory list.',
];
