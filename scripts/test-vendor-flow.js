
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const applicantPassword = 'VendorTest!2026';

async function request(path, method = 'GET', body, token, expectedStatus = 200) {
  const headers = { 'Content-Type': 'application/json' };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const result = await response.json().catch(() => ({}));

  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path}: expected HTTP ${expectedStatus}, received ${response.status}: ${JSON.stringify(result)}`
    );
  }

  return result;
}

async function main() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error('Administrator credentials were not supplied.');
  }

  console.log('\n1. Registering a new customer...');

  const uniqueEmail = `vendor.test.${Date.now()}@example.com`;

  const registration = await request('/api/auth/register', 'POST', {
    firstName: 'Vendor',
    lastName: 'Tester',
    email: uniqueEmail,
    password: applicantPassword
  }, null, 201);

  const applicantId = registration.data.user.id;
  console.log('PASS: Customer registered.');

  let applicantToken = registration.data.accessToken;

  console.log('\n2. Checking that an ordinary customer cannot create a store...');

  await request('/api/stores', 'POST', {
    storeName: 'Unauthorized Store',
    description: 'This store should not be created.',
    contactEmail: uniqueEmail,
    contactPhone: '+2348012345678',
    address: 'Abuja, Nigeria'
  }, applicantToken, 403);

  console.log('PASS: Customer was denied store creation.');

  console.log('\n3. Submitting vendor application...');

  const application = await request('/api/vendors/apply', 'POST', {
    businessName: 'KoboMarket Test Business',
    businessDescription: 'A test business for verifying vendor onboarding.',
    businessEmail: uniqueEmail,
    businessPhone: '+2348012345678',
    businessAddress: 'Abuja, Nigeria'
  }, applicantToken, 201);

  const vendorId = application.data.vendorId;

  console.log(`PASS: Application submitted (${application.data.status}).`);

  console.log('\n4. Logging in as administrator...');

  const adminLogin = await request('/api/auth/login', 'POST', {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD
  });

  const adminToken = adminLogin.data.accessToken;

  console.log('PASS: Administrator login successful.');

  console.log('\n5. Approving vendor application...');

  const approval = await request(
    `/api/admin/vendors/applications/${vendorId}/approve`,
    'PATCH',
    {},
    adminToken
  );

  console.log(`PASS: Vendor application ${approval.data.status}.`);

  console.log('\n6. Logging in again as the approved vendor...');

  const vendorLogin = await request('/api/auth/login', 'POST', {
    email: uniqueEmail,
    password: applicantPassword
  });

  applicantToken = vendorLogin.data.accessToken;

  console.log('PASS: Vendor login successful.');

  console.log('\n7. Creating vendor store...');

  const storeCreation = await request('/api/stores', 'POST', {
    storeName: 'KoboMarket Test Store',
    description: 'A test store created during vendor onboarding verification.',
    contactEmail: uniqueEmail,
    contactPhone: '+2348012345678',
    address: 'Abuja, Nigeria'
  }, applicantToken, 201);

  let slug = storeCreation.data.slug;

  console.log(`PASS: Store created with slug "${slug}".`);

  console.log('\n8. Checking public store access...');

  await request(`/api/stores/public/${slug}`);

  console.log('PASS: Public store profile is accessible.');

  console.log('\n9. Updating the store...');

  const updatedStore = await request('/api/stores/me', 'PATCH', {
    storeName: 'KoboMarket Updated Test Store'
  }, applicantToken);

  slug = updatedStore.data.store.slug;

  console.log('PASS: Store updated.');

  console.log('\n10. Checking vendor store management...');

  await request('/api/stores/me', 'GET', undefined, applicantToken);

  console.log('PASS: Vendor can access their own store.');

  console.log('\n11. Closing the store...');

  const closedStore = await request(
    '/api/stores/me/close',
    'PATCH',
    {},
    applicantToken
  );

  console.log(`PASS: Store status is ${closedStore.data.status}.`);

  console.log('\n12. Confirming closed store is no longer publicly accessible...');

  await request(`/api/stores/public/${slug}`, 'GET', undefined, undefined, 404);

  console.log('PASS: Closed store is no longer publicly accessible.');

  console.log('\n========================================');
  console.log('VENDOR AND STORE WORKFLOW: ALL TESTS PASSED');
  console.log('========================================');
  console.log(`Test applicant: ${uniqueEmail}`);
  console.log(`Applicant ID: ${applicantId}`);
  console.log(`Vendor ID: ${vendorId}`);
  console.log('The test account and records remain in the database.');
}

main().catch((error) => {
  console.error('\nTEST FAILED:', error.message);
  process.exitCode = 1;
});
