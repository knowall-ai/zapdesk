import { test, expect } from '@playwright/test';

test.describe('API Routes', () => {
  test('auth providers endpoint returns data', async ({ request }) => {
    const response = await request.get('/api/auth/providers');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('azure-ad');
  });

  test('tickets endpoint requires authentication', async ({ request }) => {
    const response = await request.get('/api/devops/tickets');
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('stats endpoint requires authentication', async ({ request }) => {
    const response = await request.get('/api/devops/stats');
    expect(response.status()).toBe(401);
  });

  test('organizations endpoint requires authentication', async ({ request }) => {
    const response = await request.get('/api/devops/projects');
    expect(response.status()).toBe(401);
  });

  // The team endpoint returns colleagues' names, emails and workloads, so an
  // unauthenticated caller must get nothing at all (#177).
  test('team endpoint requires authentication', async ({ request }) => {
    const response = await request.get('/api/devops/team');
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    // Nothing about the team should leak alongside the error.
    expect(data).not.toHaveProperty('members');
    expect(data).not.toHaveProperty('stats');
  });

  test('team endpoint requires authentication whatever the filters', async ({ request }) => {
    const response = await request.get('/api/devops/team?period=week&ticketsOnly=false');
    expect(response.status()).toBe(401);
  });

  test('email webhook requires secret header', async ({ request }) => {
    const response = await request.post('/api/email/webhook', {
      data: {
        from: 'test@example.com',
        subject: 'Test',
        body: 'Test body',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('email webhook validates payload', async ({ request }) => {
    const response = await request.post('/api/email/webhook', {
      headers: {
        'x-webhook-secret': 'invalid-secret',
      },
      data: {
        from: 'test@example.com',
        subject: 'Test',
        body: 'Test body',
      },
    });
    expect(response.status()).toBe(401);
  });
});
