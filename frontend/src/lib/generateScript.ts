import type { BoardStory, GeneratedScript, ReviewCheck } from '../types';

type Step =
  | { kind: 'open' }
  | { kind: 'login'; username: string; password: string }
  | { kind: 'add-to-cart'; product: string }
  | { kind: 'open-cart' }
  | { kind: 'add-todo'; text: string }
  | { kind: 'complete-todo' }
  | { kind: 'search'; query: string }
  | { kind: 'click'; target: string }
  | { kind: 'fill'; target: string; value: string }
  | { kind: 'assert-badge'; count: string }
  | { kind: 'check'; label: string; text: string }
  | { kind: 'assert'; expectation: string };

const URL_RE = /https?:\/\/[^\s,)]+/i;

function titleFromSteps(prompt: string, steps: Step[]): string {
  const product = steps.find((step) => step.kind === 'add-to-cart');
  const todo = steps.find((step) => step.kind === 'add-todo');
  const signsIn = steps.some((step) => step.kind === 'login');
  if (product && product.kind === 'add-to-cart' && signsIn) return `Sign in and add ${product.product}`;
  if (product && product.kind === 'add-to-cart') return `Add ${product.product} to the cart`;
  if (todo && todo.kind === 'add-todo') return `Manage todo: ${todo.text}`;
  if (signsIn) return 'Sign in and confirm the next page';
  const cleaned = prompt.replace(URL_RE, ' ').replace(/\s+/g, ' ').replace(/^open\s+/i, '').trim();
  if (!cleaned) return 'Generated Playwright flow';
  const slice = cleaned.slice(0, 72).replace(/[,.]$/, '');
  return slice.charAt(0).toUpperCase() + slice.slice(1);
}

function extractUrl(prompt: string, fallback: string): string {
  return prompt.match(URL_RE)?.[0] ?? fallback;
}

function extractCredentials(prompt: string): { username: string; password: string } {
  const asUser = prompt.match(/sign in as\s+([^\s,]+)|log(?:ged)? in as\s+([^\s,]+)|username\s+([^\s,]+)/i);
  const password = prompt.match(/password\s+([^\s,]+)/i);
  return {
    username: asUser?.[1] || asUser?.[2] || asUser?.[3] || 'standard_user',
    password: password?.[1] || 'secret_sauce',
  };
}

function parseSteps(prompt: string): Step[] {
  const steps: Step[] = [{ kind: 'open' }];
  const lower = prompt.toLowerCase();

  if (/sign in|log in|login/.test(lower)) {
    const creds = extractCredentials(prompt);
    steps.push({ kind: 'login', ...creds });
  }

  const cart = prompt.match(/add\s+(.+?)\s+to (?:the )?cart/i);
  if (cart) steps.push({ kind: 'add-to-cart', product: cart[1].replace(/["']/g, '').trim() });

  if (/open the cart|view (?:the )?cart|go to (?:the )?cart/.test(lower)) {
    steps.push({ kind: 'open-cart' });
  }

  const todo = prompt.match(/add a todo called\s+"([^"]+)"|add a todo called\s+'([^']+)'|add a todo(?: called)?\s+([^,]+)/i);
  if (todo) {
    steps.push({ kind: 'add-todo', text: (todo[1] || todo[2] || todo[3]).trim() });
  }

  if (/mark it complete|mark the todo complete|complete the todo/.test(lower)) {
    steps.push({ kind: 'complete-todo' });
  }

  const search = prompt.match(/search for\s+"([^"]+)"|search for\s+'([^']+)'|search for\s+([^,]+)/i);
  if (search) steps.push({ kind: 'search', query: (search[1] || search[2] || search[3]).trim() });

  const click = prompt.match(/click(?: the)?\s+"([^"]+)"|click(?: the)?\s+'([^']+)'/i);
  if (click) steps.push({ kind: 'click', target: click[1] || click[2] });

  const fill = prompt.match(/fill\s+"([^"]+)"\s+with\s+"([^"]+)"|enter\s+"([^"]+)"\s+in(?:to)?\s+(?:the\s+)?"([^"]+)"/i);
  if (fill) {
    if (fill[1] && fill[2]) steps.push({ kind: 'fill', target: fill[1], value: fill[2] });
    else if (fill[3] && fill[4]) steps.push({ kind: 'fill', target: fill[4], value: fill[3] });
  }

  const badge = prompt.match(/badge shows\s+(\d+)/i);
  if (badge) steps.push({ kind: 'assert-badge', count: badge[1] });

  const expectation = prompt.match(/(?:verify|assert|check that|should see)\s+(.+)$/i);
  if (expectation) {
    steps.push({ kind: 'assert', expectation: expectation[1].replace(/\.$/, '').trim() });
  } else {
    steps.push({ kind: 'assert', expectation: 'the page shows the expected result' });
  }

  return steps;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}'`;
}

function stepsFromStory(story: BoardStory): Step[] {
  const lines = story.description
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 2)
    .slice(0, 6);
  const checks = lines.length > 0 ? lines : [story.title];
  return [
    { kind: 'open' },
    ...checks.map((line) => ({
      kind: 'check' as const,
      label: line.length > 90 ? `${line.slice(0, 87)}…` : line,
      text: line.split(' ').slice(0, 8).join(' '),
    })),
  ];
}

function buildPageObject(steps: Step[]): string {
  const fields: string[] = [];
  const ctor: string[] = [];
  const methods: string[] = [];

  const needsLogin = steps.some((step) => step.kind === 'login');
  const needsCart = steps.some((step) => step.kind === 'add-to-cart' || step.kind === 'open-cart');
  const needsTodo = steps.some((step) => step.kind === 'add-todo' || step.kind === 'complete-todo');
  const search = steps.find((step) => step.kind === 'search');

  fields.push('  readonly page: Page;');
  ctor.push('    this.page = page;');

  if (needsLogin) {
    fields.push('  readonly username: Locator;', '  readonly password: Locator;', '  readonly signInButton: Locator;');
    ctor.push(
      "    this.username = page.getByRole('textbox', { name: /user/i });",
      "    this.password = page.getByRole('textbox', { name: /password/i });",
      "    this.signInButton = page.getByRole('button', { name: /login|sign in/i });",
    );
    methods.push(`  async signIn(username: string, password: string): Promise<void> {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.signInButton.click();
  }`);
  }

  if (needsCart) {
    fields.push('  readonly cartLink: Locator;');
    ctor.push("    this.cartLink = page.getByRole('link', { name: /cart/i });");
    methods.push(`  async addProduct(name: string): Promise<void> {
    const item = this.page.getByText(name, { exact: true });
    await item.scrollIntoViewIfNeeded();
    await this.page
      .locator('.inventory_item')
      .filter({ hasText: name })
      .getByRole('button', { name: /add to cart/i })
      .click();
  }

  async openCart(): Promise<void> {
    await this.cartLink.click();
  }`);
  }

  if (needsTodo) {
    fields.push('  readonly newTodo: Locator;');
    ctor.push("    this.newTodo = page.getByRole('textbox', { name: /what needs to be done/i });");
    methods.push(`  async addTodo(text: string): Promise<void> {
    await this.newTodo.fill(text);
    await this.newTodo.press('Enter');
  }

  async completeTodo(text: string): Promise<void> {
    await this.page
      .getByRole('listitem')
      .filter({ hasText: text })
      .getByRole('checkbox', { name: /toggle/i })
      .check();
  }`);
  }

  if (search && search.kind === 'search') {
    fields.push('  readonly searchBox: Locator;');
    ctor.push("    this.searchBox = page.getByRole('searchbox');");
    methods.push(`  async search(query: string): Promise<void> {
    await this.searchBox.fill(query);
    await this.searchBox.press('Enter');
  }`);
  }

  methods.push(`  async open(path = '/'): Promise<void> {
    await this.page.goto(path);
  }`);

  return `import { type Locator, type Page } from '@playwright/test';

/**
 * Page object generated by TGS Automation Studio.
 * Locators stay on the class. Assertions stay in the spec.
 */
export class FlowPage {
${fields.join('\n')}

  constructor(page: Page) {
${ctor.join('\n')}
  }

${methods.join('\n\n')}
}
`;
}

function buildSpec(options: {
  title: string;
  prompt: string;
  baseUrl: string;
  level: string;
  steps: Step[];
}): string {
  const { title, prompt, baseUrl, level, steps } = options;
  const body: string[] = [];

  for (const step of steps) {
    if (step.kind === 'open') {
      body.push(`    await test.step('Open the application', async () => {
      await flow.open('/');
    });`);
    }
    if (step.kind === 'login') {
      body.push(`    await test.step('Sign in', async () => {
      await flow.signIn(
        process.env.TEST_USER ?? ${quote(step.username)},
        process.env.TEST_PASSWORD ?? ${quote(step.password)},
      );
    });`);
    }
    if (step.kind === 'add-to-cart') {
      body.push(`    await test.step('Add ${step.product} to the cart', async () => {
      await flow.addProduct(${quote(step.product)});
    });`);
    }
    if (step.kind === 'open-cart') {
      body.push(`    await test.step('Open the cart', async () => {
      await flow.openCart();
    });`);
    }
    if (step.kind === 'add-todo') {
      body.push(`    await test.step('Add a todo', async () => {
      await flow.addTodo(${quote(step.text)});
    });`);
    }
    if (step.kind === 'complete-todo') {
      const todo = steps.find((item) => item.kind === 'add-todo');
      const text = todo && todo.kind === 'add-todo' ? todo.text : 'todo';
      body.push(`    await test.step('Mark the todo complete', async () => {
      await flow.completeTodo(${quote(text)});
    });`);
    }
    if (step.kind === 'search') {
      body.push(`    await test.step('Search', async () => {
      await flow.search(${quote(step.query)});
    });`);
    }
    if (step.kind === 'click') {
      body.push(`    await test.step('Click ${step.target}', async () => {
      await page.getByRole('button', { name: ${quote(step.target)} }).click();
    });`);
    }
    if (step.kind === 'fill') {
      body.push(`    await test.step('Fill ${step.target}', async () => {
      await page.getByLabel(${quote(step.target)}).fill(${quote(step.value)});
    });`);
    }
    if (step.kind === 'check') {
      body.push(`    await test.step(${quote(step.label)}, async () => {
      await expect(page.getByText(${quote(step.text)}).first()).toBeVisible();
    });`);
    }
    if (step.kind === 'assert-badge') {
      body.push(`    await test.step('Verify the cart badge', async () => {
      await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText(${quote(step.count)});
    });`);
    }
    if (step.kind === 'assert') {
      const product = steps.find((item) => item.kind === 'add-to-cart');
      const todo = steps.find((item) => item.kind === 'add-todo');
      if (product && product.kind === 'add-to-cart' && /cart|listed|backpack|item/i.test(step.expectation)) {
        body.push(`    await test.step('Verify the expected result', async () => {
      await expect(page.getByRole('link', { name: ${quote(product.product)} })).toBeVisible();
    });`);
      } else if (todo && todo.kind === 'add-todo') {
        body.push(`    await test.step('Verify the expected result', async () => {
      await expect(page.getByText(${quote(todo.text)})).toBeVisible();
    });`);
      } else if (steps.some((item) => item.kind === 'login')) {
        body.push(`    await test.step('Verify the expected result', async () => {
      await expect(page.getByText(/products|inventory/i)).toBeVisible();
    });`);
      } else {
        body.push(`    await test.step('Verify the expected result', async () => {
      await expect(page.getByText(${quote(step.expectation)})).toBeVisible();
    });`);
      }
    }
  }

  return `import { expect, test } from '@playwright/test';
import { FlowPage } from './flow.page';

/**
 * ${title}
 * Level: ${level}
 * Base URL: ${baseUrl}
 * Prompt: ${prompt.replace(/\*\//g, '')}
 *
 * Practices applied:
 * - Page object for locators and actions
 * - Role and label locators
 * - test.step so the report matches the prompt
 * - Web-first assertions only
 * - Credentials read from the environment
 */
test.describe(${quote(title)}, () => {
  test(${quote(title)}, async ({ page }) => {
    const flow = new FlowPage(page);

${body.join('\n\n')}
  });
});
`;
}

function buildConfig(baseUrl: string, browser: string): string {
  const project =
    browser === 'firefox'
      ? "firefox: devices['Desktop Firefox']"
      : browser === 'webkit'
        ? "webkit: devices['Desktop Safari']"
        : "chromium: devices['Desktop Chrome']";
  const projectName = project.split(':')[0];

  return `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? ${quote(baseUrl)},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: '${projectName}',
      use: { ...devices['${projectName === 'firefox' ? 'Desktop Firefox' : projectName === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'}'] },
    },
  ],
});
`;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function reviewScript(spec: string, pageObject: string): ReviewCheck[] {
  const combined = stripComments(`${spec}\n${pageObject}`);
  return [
    {
      id: 'locators',
      label: 'User-facing locators',
      passed: /getByRole|getByLabel|getByTestId|getByPlaceholder|getByText/.test(combined),
      detail: 'Role, label, test id, or text locators are present.',
    },
    {
      id: 'no-sleep',
      label: 'No fixed sleeps',
      passed: !/waitForTimeout|setTimeout\(/.test(combined),
      detail: 'The script waits with expect(), not a timer.',
    },
    {
      id: 'assert',
      label: 'Has an assertion',
      passed: /expect\(/.test(spec),
      detail: 'The spec checks an outcome.',
    },
    {
      id: 'steps',
      label: 'Readable steps',
      passed: /test\.step\(/.test(spec),
      detail: 'test.step names match the prompt.',
    },
    {
      id: 'page-object',
      label: 'Page object',
      passed: /export class FlowPage/.test(pageObject),
      detail: 'Locators live on FlowPage.',
    },
    {
      id: 'env',
      label: 'Secrets from the environment',
      passed: /process\.env/.test(spec) || !/password/i.test(spec),
      detail: 'Credentials are read from process.env when the flow signs in.',
    },
    {
      id: 'types',
      label: 'Typed Playwright imports',
      passed: /type Locator/.test(pageObject) && /from '@playwright\/test'/.test(combined),
      detail: 'Page and Locator are imported as types.',
    },
  ];
}

export function formatStory(story: BoardStory): string {
  return [`${story.key}: ${story.title}`, story.type && `Type: ${story.type}`, story.status && `Status: ${story.status}`, story.description]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function generateScript(input: {
  prompt: string;
  baseUrl: string;
  browser: string;
  level: string;
  previous?: GeneratedScript;
  story?: BoardStory;
}): GeneratedScript {
  const story = input.previous ? undefined : input.story;
  const prompt = input.previous
    ? `${input.previous.prompt} Update: ${input.prompt}`
    : input.prompt.trim() || (story ? formatStory(story) : '');
  const baseUrl = extractUrl(prompt, input.baseUrl.trim() || 'https://www.saucedemo.com');
  const parsed = parseSteps(prompt);
  const hasSpecificStep = parsed.some((step) => step.kind !== 'open' && step.kind !== 'assert');
  const steps = story && !hasSpecificStep ? stepsFromStory(story) : parsed;
  const title = input.previous?.title ?? (story ? `${story.key} ${story.title}`.slice(0, 72) : titleFromSteps(prompt, steps));
  const spec = buildSpec({ title, prompt, baseUrl, level: input.level, steps });
  const pageObject = buildPageObject(steps);
  const config = buildConfig(baseUrl, input.browser);
  const timestamp = new Date().toISOString();

  return {
    id: input.previous?.id ?? `script-${Date.now()}`,
    title,
    prompt,
    baseUrl,
    browser: input.browser,
    level: input.level,
    spec,
    pageObject,
    config,
    checks: reviewScript(spec, pageObject),
    createdAt: input.previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}
