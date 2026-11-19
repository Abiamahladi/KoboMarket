/** @jest-environment node */

const crypto = require('node:crypto');
const { db } = require('../../src/config/postgres');
const { releaseEscrow } = require(
  '../../src/modules/escrow/escrow.service'
);

jest.setTimeout(30000);

describe('Escrow release protection', () => {
  afterAll(async () => {
    await db.destroy();
  });

  test('rejects missing vendor order ID', async () => {
    await expect(
      releaseEscrow({
        vendorOrderId: null,
        initiatedBy: crypto.randomUUID()
      })
    ).rejects.toThrow(
      'Vendor order ID and initiating user are required'
    );
  });

  test('rejects missing initiating user', async () => {
    await expect(
      releaseEscrow({
        vendorOrderId: crypto.randomUUID(),
        initiatedBy: null
      })
    ).rejects.toThrow(
      'Vendor order ID and initiating user are required'
    );
  });

  test('rejects a nonexistent vendor order', async () => {
    await expect(
      releaseEscrow({
        vendorOrderId: crypto.randomUUID(),
        initiatedBy: crypto.randomUUID()
      })
    ).rejects.toThrow('Vendor order not found');
  });
});
