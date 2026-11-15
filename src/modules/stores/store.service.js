
const Vendor = require('../vendors/vendor.model');
const Store = require('./store.model');

const createSlug = (value) => {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
};

const storeService = {
  // Create a store for an approved vendor.
  async create(userId, storeData) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw new Error('Only approved vendors can create stores');
    }

    const existingStore = await Store.findOne({
      vendorId: vendor.vendorId
    });

    if (existingStore) {
      throw new Error('This vendor already has a store');
    }

    const slug = createSlug(storeData.storeName);

    if (!slug) {
      throw new Error('Store name cannot produce a valid URL slug');
    }

    const existingSlug = await Store.findOne({ slug });

    if (existingSlug) {
      throw new Error('This store URL is already in use');
    }

    try {
      return await Store.create({
        vendorId: vendor.vendorId,
        storeName: storeData.storeName,
        slug,
        description: storeData.description,
        logo: storeData.logo || null,
        contactEmail: storeData.contactEmail,
        contactPhone: storeData.contactPhone,
        address: storeData.address
      });
    } catch (error) {
      if (error.code === 11000) {
        throw new Error('Store already exists or its URL is already in use');
      }

      throw error;
    }
  },

  // Retrieve the authenticated vendor's store.
  async getMyStore(userId) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw new Error('Approved vendor account not found');
    }

    const store = await Store.findOne({
      vendorId: vendor.vendorId
    }).lean();

    if (!store) {
      throw new Error('Store not found');
    }

    return store;
  },

  // Retrieve a public store profile.
  async getPublicStore(slug) {
    const store = await Store.findOne({
      slug,
      status: 'active'
    }).lean();

    if (!store) {
      throw new Error('Store not found');
    }

    return store;
  },

  // Update the authenticated vendor's store.
  async update(userId, updateData) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw new Error('Approved vendor account not found');
    }

    const store = await Store.findOne({
      vendorId: vendor.vendorId,
      status: 'active'
    });

    if (!store) {
      throw new Error('Active store not found');
    }

    const allowedFields = [
      'storeName',
      'description',
      'logo',
      'contactEmail',
      'contactPhone',
      'address'
    ];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        store[field] = updateData[field];
      }
    }

    if (updateData.storeName !== undefined) {
      const newSlug = createSlug(updateData.storeName);

      if (!newSlug) {
        throw new Error('Store name cannot produce a valid URL slug');
      }

      const existingSlug = await Store.findOne({
        slug: newSlug,
        storeId: { $ne: store.storeId }
      });

      if (existingSlug) {
        throw new Error('This store URL is already in use');
      }

      store.slug = newSlug;
    }

    try {
      await store.save();
    } catch (error) {
      if (error.code === 11000) {
        throw new Error('This store URL is already in use');
      }

      throw error;
    }

    return store;
  },

  // Close the authenticated vendor's store.
  async close(userId) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw new Error('Approved vendor account not found');
    }

    const store = await Store.findOneAndUpdate(
      {
        vendorId: vendor.vendorId,
        status: 'active'
      },
      {
        $set: { status: 'closed' }
      },
      { new: true }
    );

    if (!store) {
      throw new Error('Active store not found');
    }

    return store;
  }
};

module.exports = storeService;

