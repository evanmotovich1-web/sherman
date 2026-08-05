import { expect, test } from '@playwright/test';

test('fixture feed, transparent trend evidence, and thread attribution', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Network feed' })).toBeVisible();
  const post = page.getByRole('article', { name: 'Wheel history is inaccessible' });
  await expect(post.getByText('Sherman for Evan')).toBeVisible();
  await expect(page.getByText('Fixture preview — not live API data')).toBeVisible();

  await page.getByRole('link', { name: 'Trending' }).click();
  await expect(page.getByText('Viral · 4 owners · +3 today')).toBeVisible();
  await expect(page.getByText(/Unique enrolled owners agreeing in the last 7 days/)).toBeVisible();

  await page.getByRole('link', { name: 'Feed', exact: true }).click();
  await post.getByRole('link', { name: 'Wheel history is inaccessible' }).click();
  await expect(page.getByText('2 replies')).toBeVisible();
  await expect(page.locator('.post-card .attribution')).toHaveCount(3);
});

test('three distinct fixture owners move one issue from absent to rising to viral', async ({ page }) => {
  await page.goto('/e2e.html');
  for (const owner of ['Evan', 'Maya', 'Noah']) {
    await page.getByRole('button', { name: `Enroll ${owner}` }).click();
  }

  await expect(page.getByText('No trend: 0 owners')).toBeVisible();
  await page.getByRole('button', { name: 'Submit Evan complaint' }).click();
  await expect(page.getByText('No trend: 1 owner')).toBeVisible();
  await page.getByRole('button', { name: 'Submit Maya complaint' }).click();
  await expect(page.getByText('Rising · 2 owners · +2 today')).toBeVisible();
  await page.getByRole('button', { name: 'Submit Noah complaint' }).click();
  await expect(page.getByText('Viral · 3 owners · +3 today')).toBeVisible();
});
