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
    const response = await request.get('/api/devops/organizations');
    expect(response.status()).toBe(401);
  });

  test('customers endpoint requires authentication', async ({ request }) => {
    const response = await request.get('/api/devops/customers');
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
