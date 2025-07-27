// src/database/schemas.js
export const businessSchema = {
  title: 'business schema',
  version: 0,
  description: 'describes a business',
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
      maxLength: 100,
    },
    name: {
      type: 'string',
    }
  },
  required: ['id', 'name'],
};


export const articleSchema = {
  title: 'article',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  description: 'describes an article',
  properties: {
    id: {
      type: 'string',
      maxLength: 100,
    },
    name: {
      type: 'string'
    },
    qty: {
      type: 'number'
    },
    selling_price: {
      type: 'number'
    },
    business_id: {
      type: 'string'
    }
  },
  required: ['id', 'name', 'qty', 'selling_price', 'business_id']
};

