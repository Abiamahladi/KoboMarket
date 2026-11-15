
const Vendor = require('./vendor.model');
const User = require('../users/user.model');
const roleService = require('../authorization/role.service');

const vendorService = {
  // Submit a vendor application.
  async apply(userId, applicationData) {
    const user = await User.findOne({ userId });

    if (!user) {
      throw new Error('User account not found');
    }

    if (user.status !== 'active') {
      throw new Error('Your account is not active');
    }

    if ((user.roles || []).includes('vendor')) {
      throw new Error('User is already an approved vendor');
    }

    const existingApplication = await Vendor.findOne({ userId });

    if (existingApplication) {
      throw new Error('A vendor application already exists');
    }

    const vendor = await Vendor.create({
      userId,
      businessName: applicationData.businessName,
      businessDescription: applicationData.businessDescription,
      businessEmail: applicationData.businessEmail,
      businessPhone: applicationData.businessPhone,
      businessAddress: applicationData.businessAddress
    });

    return vendor;
  },

  // List vendor applications for administrator review.
  async listApplications(status = 'pending') {
    const allowedStatuses = [
      'pending',
      'approved',
      'rejected',
      'suspended'
    ];

    if (!allowedStatuses.includes(status)) {
      throw new Error('Invalid vendor application status');
    }

    return Vendor.find({ status })
      .sort({ createdAt: -1 })
      .lean();
  },

  // Approve a pending vendor application.
  async approve(vendorId, adminId, request) {
    const vendor = await Vendor.findOneAndUpdate(
      { vendorId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          rejectionReason: null
        }
      },
      { new: true }
    );

    if (!vendor) {
      throw new Error('Pending vendor application not found');
    }

    try {
      await roleService.grantRole({
        actorId: adminId,
        targetUserId: vendor.userId,
        role: 'vendor',
        request
      });
    } catch (error) {
      // Restore the application if granting the role fails.
      const restored = await Vendor.updateOne(
        { vendorId, status: 'approved', reviewedBy: adminId },
        {
          $set: {
            status: 'pending',
            reviewedBy: null,
            reviewedAt: null
          }
        }
      );

      if (restored.modifiedCount !== 1) {
        throw new Error(
          'CRITICAL: Vendor approval failed and application status restoration could not be confirmed'
        );
      }

      throw error;
    }

    return vendor;
  },

  // Reject a pending vendor application.
  async reject(vendorId, adminId, reason) {
    if (!reason || !reason.trim()) {
      throw new Error('A rejection reason is required');
    }

    const vendor = await Vendor.findOneAndUpdate(
      { vendorId, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          rejectionReason: reason.trim()
        }
      },
      { new: true }
    );

    if (!vendor) {
      throw new Error('Pending vendor application not found');
    }

    return vendor;
  }
};

module.exports = vendorService;
