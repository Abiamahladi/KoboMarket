
const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  VENDOR: 'vendor',
  ADMIN: 'admin'
});

const ROLE_VALUES = Object.freeze(Object.values(ROLES));

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.CUSTOMER]: [
    'profile:read',
    'profile:update',
    'product:read',
    'cart:manage',
    'order:create',
    'order:read_own',
    'wallet:read_own',
    'wallet:fund',
    'review:create',
    'review:read'
  ],

  [ROLES.VENDOR]: [
    'profile:read',
    'profile:update',
    'product:read',
    'product:create',
    'product:update_own',
    'product:delete_own',
    'store:manage_own',
    'inventory:manage_own',
    'vendor_order:read_own',
    'vendor_order:fulfil_own',
    'wallet:read_own',
    'payout:request',
    'review:read'
  ],

  [ROLES.ADMIN]: [
    'user:read',
    'user:manage',
    'vendor:approve',
    'vendor:suspend',
    'product:manage',
    'order:read',
    'dispute:manage',
    'refund:manage',
    'payout:manage',
    'report:read',
    'platform:manage'
  ]
});

module.exports = {
  ROLES,
  ROLE_VALUES,
  ROLE_PERMISSIONS
};
