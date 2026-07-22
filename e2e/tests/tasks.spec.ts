import { test, expect } from '@playwright/test';

test.describe('Tasks page', () => {
  test('create → validation error → pool → claim → banner → My Tasks → complete lifecycle', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('tab', { name: 'My Tasks' })).toBeVisible();

    // Guided create (v2): no title input — pick a group, title composes itself.
    await page.getByRole('button', { name: 'New Task' }).click();
    const dialog = page.getByRole('dialog');
    const dialogHeading = page.getByRole('heading', { name: 'New Task' });
    await expect(dialogHeading).toBeVisible();

    // Create with nothing picked → inline validation, modal stays open.
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText("Pick a task group — it's the only required field.")).toBeVisible();
    await expect(dialogHeading).toBeVisible();

    // Pick Escalation (no payer/practice → title is just the group label),
    // and add a unique note so this run's task is identifiable.
    await dialog.getByLabel('Task group *').selectOption('ESCALATION');
    await expect(dialog.getByRole('status', { name: 'Task title, automatic' })).toContainText('Escalation');
    await dialog.getByLabel(/note/i).fill(`e2e run ${Date.now()}`);
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(dialogHeading).toBeHidden();

    // Unassigned tasks land in the Task Pool. The composed title is always
    // just "Escalation" here (no payer/practice picked), so leftover tasks
    // from prior runs may also match — .first() picks this run's row.
    await page.getByRole('tab', { name: 'Task Pool' }).click();
    const poolRow = page.locator('div.group', { hasText: 'Escalation' }).first();
    await expect(poolRow).toBeVisible();
    await poolRow.getByRole('button', { name: 'Claim' }).click();

    // Claim shows a "Claimed ✓" banner with an Undo button for ~6s — assert
    // promptly.
    await expect(page.getByText('Claimed ✓')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

    // The claimed task now shows up under My Tasks, where it can be marked
    // complete.
    await page.getByRole('tab', { name: 'My Tasks' }).click();
    const myRow = page.locator('div.group', { hasText: 'Escalation' }).first();
    await expect(myRow).toBeVisible();
    await myRow.getByRole('button', { name: 'Mark complete: Escalation' }).click();

    // My Tasks defaults to open-only, so completing the task removes it from
    // this view on refetch — toggle "Show completed" to confirm it landed in
    // the completed state rather than asserting on a row that's about to
    // disappear.
    await page.getByLabel('Show completed').check();
    const completedRow = page.locator('div.group', { hasText: 'Escalation' }).first();
    await expect(completedRow.getByRole('button', { name: 'Completed: Escalation' })).toBeVisible();
  });
});

test.describe('Tasks v2 — needs review + reason dialog', () => {
  test('overdue task → arrival dialog defer/save → admin needs-review flow', async ({ page }) => {
    const note = `e2e overdue ${Date.now()}`;

    // 1. Create a task assigned to ME with a due date in the past.
    await page.goto('/tasks');
    // Defer any dialog left over from previous runs so the page is usable.
    const stale = page.getByRole('button', { name: "I'll answer later" });
    if (await stale.isVisible().catch(() => false)) await stale.click();

    await page.getByRole('button', { name: 'New Task' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Task group *').selectOption('VERIFY_INFORMATION');
    await dialog.getByLabel(/note/i).fill(note);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel('Due Date').fill(yesterday);
    // Assign to myself: option 0 is "Leave in Task Pool", option 1 is the
    // first assignee — the seeded admin running this session. (Playwright's
    // selectOption label matcher takes exact strings only, and the admin's
    // display name varies per environment, so select by index.)
    await dialog.getByLabel('Assign To').selectOption({ index: 1 });
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('heading', { name: 'New Task' })).toBeHidden();

    // 2. Re-arrive → the prompt-on-arrival dialog fires. Esc = deferral.
    await page.reload();
    const reasonDialog = page.getByRole('alertdialog');
    await expect(reasonDialog).toBeVisible();
    await expect(reasonDialog.getByText(/Before you dive in — \d+ task/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reasonDialog).toBeHidden();

    // 3. Re-arms on the next arrival; quick chip + edit + save.
    await page.reload();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Waiting on documents' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save reasons' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();

    // 4. Admin Needs review tab: the reason sits on the row; Close resolves it.
    await page.getByRole('tab', { name: /needs review/i }).click();
    await expect(page.getByText('Reason: "Waiting on documents"').first()).toBeVisible();
    await page.getByRole('button', { name: /^Close — Verify Information/ }).first().click();
    await expect(page.getByText('Reason: "Waiting on documents"').first()).toBeHidden();
  });
});
