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
