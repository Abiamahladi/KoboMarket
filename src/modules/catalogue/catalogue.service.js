const Product = require('./product.model');
const Category = require('./category.model');
const Vendor = require('../vendors/vendor.model');
const Store = require('../stores/store.model');
const cacheService = require('../../services/cache.service');

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const catalogueService = {
  async createCategory(data, adminId) {
    const slug = slugify(data.name);

    const existing = await Category.findOne({ slug });

    if (existing) {
      throw createError('A category with this name already exists', 409);
    }

    const category = await Category.create({
      name: data.name,
      slug,
      description: data.description || '',
      createdBy: adminId
    });

    await cacheService.del(cacheService.keys.categories());

    return category;
  },

  async listCategories() {
    return cacheService.remember(
      cacheService.keys.categories(),
      300,
      async () =>
        Category.find({ status: 'active' })
          .sort({ name: 1 })
          .lean()
    );
  },

  async updateCategory(categoryId, data) {
    const category = await Category.findOne({ categoryId });

    if (!category) {
      throw createError('Category not found', 404);
    }

    if (data.name) {
      category.name = data.name;
      category.slug = slugify(data.name);
    }

    if (data.description !== undefined) {
      category.description = data.description;
    }

    if (data.status) {
      category.status = data.status;
    }

    try {
      await category.save();
    } catch (error) {
      if (error.code === 11000) {
        throw createError('A category with this name already exists', 409);
      }
      throw error;
    }

    await cacheService.del(cacheService.keys.categories());

    return category;
  },

  async createProduct(userId, data) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw createError('You must have an approved vendor account', 403);
    }

    const store = await Store.findOne({
      vendorId: vendor.vendorId,
      status: 'active'
    });

    if (!store) {
      throw createError('You must have an active store', 403);
    }

    const category = await Category.findOne({
      categoryId: data.categoryId,
      status: 'active'
    });

    if (!category) {
      throw createError('Active category not found', 404);
    }

    const slug = slugify(data.name);

    const existing = await Product.findOne({
      storeId: store.storeId,
      slug
    });

    if (existing) {
      throw createError('A product with this name already exists in your store', 409);
    }

    const product = await Product.create({
      vendorId: vendor.vendorId,
      storeId: store.storeId,
      categoryId: category.categoryId,
      name: data.name,
      slug,
      description: data.description,
      sku: data.sku || null,
      priceKobo: data.priceKobo,
      currency: 'NGN',
      stockQuantity: data.stockQuantity ?? 0,
      images: data.images || [],
      tags: data.tags || [],
      status: data.status || 'draft'
    });

    await cacheService.delByPattern('kobomarket:products:list:*');

    return product;
  },

  async listProducts(query) {
    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);
    const skip = (page - 1) * limit;

    const filters = {
      status: 'active'
    };

    if (query.categoryId) {
      filters.categoryId = query.categoryId;
    }

    if (query.vendorId) {
      filters.vendorId = query.vendorId;
    }

    if (query.search) {
      filters.$text = { $search: query.search };
    }

    const cacheKey =
      `${cacheService.keys.productList(page)}:` +
      encodeURIComponent(JSON.stringify({
        filters,
        limit,
        sort: query.sort || 'newest'
      }));

    return cacheService.remember(cacheKey, 300, async () => {
      const sortOptions = {
        newest: { createdAt: -1 },
        price_asc: { priceKobo: 1 },
        price_desc: { priceKobo: -1 },
        rating: { averageRating: -1 }
      };

      const [products, total] = await Promise.all([
        Product.find(filters)
          .sort(sortOptions[query.sort] || sortOptions.newest)
          .skip(skip)
          .limit(limit)
          .lean(),

        Product.countDocuments(filters)
      ]);

      return {
        products,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    });
  },

  async getProduct(productId) {
    const cacheKey = cacheService.keys.product(productId);

    return cacheService.remember(cacheKey, 300, async () => {
      const product = await Product.findOne({
        productId,
        status: 'active'
      }).lean();

      if (!product) {
        throw createError('Product not found', 404);
      }

      return product;
    });
  },

  async getMyProducts(userId) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw createError('Approved vendor account required', 403);
    }

    return Product.find({
      vendorId: vendor.vendorId
    }).sort({ createdAt: -1 }).lean();
  },

  async updateProduct(userId, productId, data) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw createError('Approved vendor account required', 403);
    }

    const product = await Product.findOne({
      productId,
      vendorId: vendor.vendorId
    });

    if (!product) {
      throw createError('Product not found in your catalogue', 404);
    }

    if (data.categoryId) {
      const category = await Category.findOne({
        categoryId: data.categoryId,
        status: 'active'
      });

      if (!category) {
        throw createError('Active category not found', 404);
      }

      product.categoryId = category.categoryId;
    }

    if (data.name && data.name !== product.name) {
      const newSlug = slugify(data.name);

      const existing = await Product.findOne({
        storeId: product.storeId,
        slug: newSlug,
        productId: { $ne: productId }
      });

      if (existing) {
        throw createError('A product with this name already exists in your store', 409);
      }

      product.name = data.name;
      product.slug = newSlug;
    }

    const allowedFields = [
      'description',
      'priceKobo',
      'stockQuantity',
      'sku',
      'images',
      'tags',
      'status'
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        product[field] = data[field];
      }
    }

    await product.save();

    await cacheService.invalidateProduct(productId);
    await cacheService.delByPattern('kobomarket:products:list:*');

    return product;
  },

  async archiveProduct(userId, productId) {
    const vendor = await Vendor.findOne({
      userId,
      status: 'approved'
    });

    if (!vendor) {
      throw createError('Approved vendor account required', 403);
    }

    const product = await Product.findOneAndUpdate(
      {
        productId,
        vendorId: vendor.vendorId,
        status: { $ne: 'archived' }
      },
      {
        $set: { status: 'archived' }
      },
      { new: true }
    );

    if (!product) {
      throw createError('Product not found or already archived', 404);
    }

    await cacheService.invalidateProduct(productId);
    await cacheService.delByPattern('kobomarket:products:list:*');

    return product;
  }
};

module.exports = catalogueService;
