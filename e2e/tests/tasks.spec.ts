import { test, expect } from '@playwright/test';

test.describe('Tasks page', () => {
  test('create → validation error → pool → claim → banner → My Tasks → complete lifecycle', async ({ page }) => {
    const title = `E2E task ${Date.now()}`;

    await page.goto('/tasks');
    await expect(page.getByRole('tab', { name: 'My Tasks' })).toBeVisible();

    // Open the New Task modal. The dialog's outer wrapper is a HeadlessUI
    // <Dialog> whose only children are `fixed inset-0` overlays, so it
    // collapses to a zero-size box in normal flow and never reports as
    // "visible" via a bounding-box check — assert on its heading instead,
    // and use the dialog only to scope descendant queries.
    await page.getByRole('button', { name: 'New Task' }).click();
    const dialog = page.getByRole('dialog');
    const dialogHeading = page.getByRole('heading', { name: 'New Task' });
    await expect(dialogHeading).toBeVisible();

    // Submitting with an empty title surfaces the inline validation error and
    // keeps the modal open.
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText('Give the task a title so the team knows what it is.')).toBeVisible();
    await expect(dialogHeading).toBeVisible();

    // Fill in a unique, timestamped title so this test is resilient to
    // leftover tasks from manual testing in the pool, then submit for real.
    await dialog.getByLabel('Title *').fill(title);
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(dialogHeading).toBeHidden();

    // Unassigned tasks land in the Task Pool.
    await page.getByRole('tab', { name: 'Task Pool' }).click();
    const poolRow = page.locator('div.group', { hasText: title });
    await expect(poolRow).toBeVisible();
    await poolRow.getByRole('button', { name: 'Claim' }).click();

    // Claim shows a "Claimed ✓" banner with an Undo button for ~6s — assert
    // promptly.
    await expect(page.getByText('Claimed ✓')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

    // The claimed task now shows up under My Tasks, where it can be marked
    // complete.
    await page.getByRole('tab', { name: 'My Tasks' }).click();
    const myRow = page.locator('div.group', { hasText: title });
    await expect(myRow).toBeVisible();
    await myRow.getByRole('button', { name: `Mark complete: ${title}` }).click();

    // My Tasks defaults to open-only, so completing the task removes it from
    // this view on refetch — toggle "Show completed" to confirm it landed in
    // the completed state rather than asserting on a row that's about to
    // disappear.
    await page.getByLabel('Show completed').check();
    const completedRow = page.locator('div.group', { hasText: title });
    await expect(completedRow.getByRole('button', { name: `Completed: ${title}` })).toBeVisible();
  });
});
