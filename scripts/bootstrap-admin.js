
const readline = require('readline');
const mongoose = require('mongoose');

const User = require('../src/modules/users/user.model');
const connectMongoDB = require('../src/config/mongodb');
const { connectPostgres, db } = require('../src/config/postgres');
const auditService = require('../src/modules/audit/audit.service');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question) =>
  new Promise((resolve) => rl.question(question, resolve));

async function bootstrapAdmin() {
  try {
    console.log('\n=== KoboMarket Admin Bootstrap ===\n');

    await connectMongoDB();
    await connectPostgres();

    // This script is only for creating the initial administrator.
    const existingAdmins = await User.countDocuments({
      roles: 'admin',
      status: 'active'
    });

    if (existingAdmins > 0) {
      throw new Error(
        'An active administrator already exists. Initial bootstrap is disabled.'
      );
    }

    const email = (await ask('Enter existing user email: '))
      .trim()
      .toLowerCase();

    if (!email) {
      throw new Error('Email address is required');
    }

    const user = await User.findOne({ email });

    if (!user) {
      throw new Error('User account not found. Register the user first.');
    }

    if (user.status !== 'active') {
      throw new Error('Cannot promote an inactive user');
    }

    const oldRoles = [...(user.roles || [])];

    if (oldRoles.includes('admin')) {
      throw new Error('This account is already an administrator');
    }

    const pgUser = await db('users')
      .where({ id: user.userId })
      .first();

    if (!pgUser) {
      throw new Error(
        'PostgreSQL identity reference not found. Cannot continue.'
      );
    }

    const confirmed = (await ask(
      `\nGrant initial administrator access to ${email}? (yes/no): `
    )).trim().toLowerCase();

    if (confirmed !== 'yes') {
      console.log('\nAdmin bootstrap cancelled.');
      return;
    }

    const newRoles = [...oldRoles, 'admin'];

    // Grant administrator role in MongoDB.
    user.roles = newRoles;
    await user.save();

    try {
      // Record the initial administrator assignment.
      await auditService.log({
        actorId: null,
        actorType: 'system',
        action: 'user.role.bootstrap_admin',
        resourceType: 'user',
        resourceId: user.userId,
        oldValues: { roles: oldRoles },
        newValues: { roles: newRoles },
        description: 'Initial administrator role granted through local bootstrap'
      });
    } catch (auditError) {
      // Attempt to restore the original roles if auditing fails.
      const rollback = await User.updateOne(
        { userId: user.userId, roles: newRoles },
        { $set: { roles: oldRoles } }
      );

      if (rollback.modifiedCount !== 1) {
        throw new Error(
          'CRITICAL: Audit logging failed and role restoration could not be confirmed.'
        );
      }

      throw new Error(
        `Audit logging failed. Original roles restored: ${auditError.message}`
      );
    }

    console.log('\nAdministrator created successfully.');
    console.log('Email:', user.email);
    console.log('Roles:', newRoles);

  } catch (error) {
    console.error('\nBootstrap failed:', error.message);
    process.exitCode = 1;
  } finally {
    rl.close();

    try {
      await db.destroy();
      await mongoose.disconnect();
    } catch (error) {
      // Ignore cleanup errors if connections were not established.
    }
  }
}

bootstrapAdmin();
