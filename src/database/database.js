// src/database/database.js
import { createRxDatabase, addRxPlugin } from 'rxdb';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { replicateCouchDB, getFetchWithCouchDBAuthorization } from 'rxdb/plugins/replication-couchdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { articleSchema, businessSchema } from './schemas';
import { config } from '../config/environment';

// Add plugins
addRxPlugin(RxDBQueryBuilderPlugin);
addRxPlugin(RxDBUpdatePlugin);

let dbInstance;
const DB_NAME = 'businessapp';

// AsyncStorage keys
const BUSINESSES_KEY = 'businesses_data';
const ARTICLES_KEY = 'articles_data';
const COUCHDB_URL_KEY = 'couchdb_url';

const COUCHDB_CONFIG = {
  possibleUrls: config.couchdb.possibleUrls,
  businessesDB: config.couchdb.businessesDB,
  articlesDB: config.couchdb.articlesDB,
  username: config.couchdb.username,
  password: config.couchdb.password,
  currentUrl: null,
  timeout: config.couchdb.timeout
};

let businessReplication = null;
let articleReplication = null;
let isOnline = false;

// Auto-detect working CouchDB URL
const detectCouchDBUrl = async () => {
  const savedUrl = await AsyncStorage.getItem(COUCHDB_URL_KEY);
  if (savedUrl && await testCouchDBUrl(savedUrl)) {
    COUCHDB_CONFIG.currentUrl = savedUrl;
    return savedUrl;
  }

  for (const url of COUCHDB_CONFIG.possibleUrls) {
    if (await testCouchDBUrl(url)) {
      COUCHDB_CONFIG.currentUrl = url;
      await AsyncStorage.setItem(COUCHDB_URL_KEY, url);
      return url;
    }
  }
  return null;
};

// Test a specific CouchDB URL
const testCouchDBUrl = async (url) => {
  try {
    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COUCHDB_CONFIG.timeout);

    const cleanUrl = url.replace(/\/$/, '');
    const response = await customFetch(`${cleanUrl}/`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
};

export const initDatabase = async () => {
  if (dbInstance) return dbInstance;

  try {
    const db = await createRxDatabase({
      name: DB_NAME,
      storage: getRxStorageMemory(),
      multiInstance: false,
      ignoreDuplicate: true,
    });

    await db.addCollections({
      businesses: { schema: businessSchema },
      articles: { schema: articleSchema }
    });

    // Load persisted data
    await loadPersistedData(db);
    
    // Setup network monitoring and sync
    await setupNetworkMonitoring(db);

    dbInstance = db;
    return db;
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
};

// Setup network monitoring and auto-sync
const setupNetworkMonitoring = async (db) => {
  try {
    const netInfo = await NetInfo.fetch();
    isOnline = netInfo.isConnected;

    if (isOnline) {
      const workingUrl = await detectCouchDBUrl();
      if (workingUrl) {
        await createCouchDBDatabases();
        await startSync(db);
      }
    }

    NetInfo.addEventListener(state => {
      const wasOffline = !isOnline;
      isOnline = state.isConnected;
      
      if (wasOffline && isOnline) {
        detectCouchDBUrl().then(workingUrl => {
          if (workingUrl) {
            createCouchDBDatabases().then(() => startSync(db));
          }
        });
      } else if (!isOnline) {
        stopSync();
      }
    });
  } catch (error) {
    console.error('Error setting up network monitoring:', error);
  }
};

// Start bidirectional sync
const startSync = async (db) => {
  if (!isOnline || !COUCHDB_CONFIG.currentUrl) return;

  try {
    stopSync();

    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    const baseUrl = COUCHDB_CONFIG.currentUrl.replace(/\/+$/, '');
    const businessUrl = baseUrl + '/businesses/';
    const articleUrl = baseUrl + '/articles/';

    // Setup businesses replication
    businessReplication = replicateCouchDB({
      replicationIdentifier: 'business-replication',
      collection: db.businesses,
      url: businessUrl,
      live: true,
      fetch: customFetch,
      pull: { batchSize: 10 },
      push: { batchSize: 10 }
    });

    // Setup articles replication
    articleReplication = replicateCouchDB({
      replicationIdentifier: 'article-replication',
      collection: db.articles,
      url: articleUrl,
      live: true,
      fetch: customFetch,
      pull: { batchSize: 10 },
      push: { batchSize: 10 }
    });

    // Auto-save to AsyncStorage on sync
    if (businessReplication) {
      businessReplication.sent$.subscribe(() => {
        setTimeout(() => saveBusinessesToStorage(db), 1000);
      });
      businessReplication.received$.subscribe(() => {
        setTimeout(() => saveBusinessesToStorage(db), 1000);
      });
    }

    if (articleReplication) {
      articleReplication.sent$.subscribe(() => {
        setTimeout(() => saveArticlesToStorage(db), 1000);
      });
      articleReplication.received$.subscribe(() => {
        setTimeout(() => saveArticlesToStorage(db), 1000);
      });
    }

  } catch (error) {
    console.error('Error starting sync:', error);
  }
};

// Stop sync replications
const stopSync = () => {
  try {
    if (businessReplication) {
      businessReplication.cancel();
      businessReplication = null;
    }
    if (articleReplication) {
      articleReplication.cancel();
      articleReplication = null;
    }
  } catch (error) {
    console.error('Error stopping sync:', error);
  }
};

// Load persisted data from AsyncStorage
const loadPersistedData = async (db) => {
  try {
    const businessesData = await AsyncStorage.getItem(BUSINESSES_KEY);
    const businesses = businessesData ? JSON.parse(businessesData) : [];
    
    for (const business of businesses) {
      try {
        await db.businesses.insert(business);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.error('Error inserting business:', error);
        }
      }
    }

    const articlesData = await AsyncStorage.getItem(ARTICLES_KEY);
    const articles = articlesData ? JSON.parse(articlesData) : [];
    
    for (const article of articles) {
      try {
        await db.articles.insert(article);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.error('Error inserting article:', error);
        }
      }
    }
  } catch (error) {
    console.error('Error loading persisted data:', error);
  }
};

// Save to AsyncStorage
const saveBusinessesToStorage = async (db) => {
  try {
    const allBusinesses = await db.businesses.find().exec();
    const businessData = allBusinesses.map(doc => doc.toJSON());
    await AsyncStorage.setItem(BUSINESSES_KEY, JSON.stringify(businessData));
    return businessData;
  } catch (error) {
    console.error('Error saving businesses:', error);
    return [];
  }
};

const saveArticlesToStorage = async (db) => {
  try {
    const allArticles = await db.articles.find().exec();
    const articleData = allArticles.map(doc => doc.toJSON());
    await AsyncStorage.setItem(ARTICLES_KEY, JSON.stringify(articleData));
    return articleData;
  } catch (error) {
    console.error('Error saving articles:', error);
    return [];
  }
};

// Create CouchDB databases
const createCouchDBDatabases = async () => {
  if (!isOnline || !COUCHDB_CONFIG.currentUrl) return;

  try {
    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    const cleanUrl = COUCHDB_CONFIG.currentUrl.replace(/\/$/, '');

    // Create businesses database
    await customFetch(`${cleanUrl}/${COUCHDB_CONFIG.businessesDB}`, { method: 'PUT' });
    
    // Create articles database
    await customFetch(`${cleanUrl}/${COUCHDB_CONFIG.articlesDB}`, { method: 'PUT' });

  } catch (error) {
    console.error('Error creating CouchDB databases:', error);
  }
};

// Sync AsyncStorage with RxDB
export const syncStorageWithDatabase = async () => {
  try {
    const db = await initDatabase();
    
    const businesses = await db.businesses.find().exec();
    const articles = await db.articles.find().exec();
    
    const businessData = businesses.map(doc => doc.toJSON());
    const articleData = articles.map(doc => doc.toJSON());
    
    await AsyncStorage.setItem(BUSINESSES_KEY, JSON.stringify(businessData));
    await AsyncStorage.setItem(ARTICLES_KEY, JSON.stringify(articleData));
    
    return { success: true, businesses: businessData.length, articles: articleData.length };
  } catch (error) {
    console.error('Error syncing storage with database:', error);
    return { success: false, message: error.message };
  }
};

// CRUD Operations
export const addBusiness = async (business) => {
  try {
    const db = await initDatabase();
    const businessDoc = {
      id: business.id,
      name: business.name,
    };
    
    const inserted = await db.businesses.insert(businessDoc);
    await saveBusinessesToStorage(db);
    
    return inserted;
  } catch (error) {
    console.error('Error adding business:', error);
    throw error;
  }
};

export const addArticle = async (article) => {
  try {
    const db = await initDatabase();
    const inserted = await db.articles.insert(article);
    await saveArticlesToStorage(db);
    
    return inserted;
  } catch (error) {
    console.error('Error adding article:', error);
    throw error;
  }
};

export const updateBusiness = async (businessId, updatedData) => {
  try {
    const db = await initDatabase();
    
    const businessDoc = await db.businesses
      .findOne()
      .where('id')
      .equals(businessId)
      .exec();
    
    if (!businessDoc) {
      throw new Error('Business not found');
    }
    
    const updatedDoc = await businessDoc.modify(docData => {
      docData.name = updatedData.name;
      return docData;
    });
    
    await saveBusinessesToStorage(db);
    return updatedDoc;
  } catch (error) {
    console.error('Error updating business:', error);
    throw error;
  }
};

export const updateArticleData = async (articleId, updatedData) => {
  try {
    const db = await initDatabase();
    
    const articleDoc = await db.articles
      .findOne()
      .where('id')
      .equals(articleId)
      .exec();
    
    if (!articleDoc) {
      throw new Error('Article not found');
    }
    
    const updatedDoc = await articleDoc.modify(docData => {
      docData.name = updatedData.name;
      docData.qty = updatedData.qty;
      docData.selling_price = updatedData.selling_price;
      docData.business_id = updatedData.business_id;
      return docData;
    });
    
    await saveArticlesToStorage(db);
    return updatedDoc;
  } catch (error) {
    console.error('Error updating article:', error);
    throw error;
  }
};

export const deleteBusiness = async (businessDoc) => {
  try {
    await businessDoc.remove();
    
    const db = await initDatabase();
    await saveBusinessesToStorage(db);
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting business:', error);
    throw error;
  }
};

export const deleteArticleWithSync = async (articleId) => {
  try {
    const db = await initDatabase();
    
    const articleDoc = await db.articles
      .findOne()
      .where('id')
      .equals(articleId)
      .exec();
    
    if (!articleDoc) {
      return false;
    }
    
    await articleDoc.remove();
    await saveArticlesToStorage(db);
    
    return true;
  } catch (error) {
    console.error('Error in deleteArticleWithSync:', error);
    throw error;
  }
};

// Read operations
export const getArticlesByBusinessId = async (businessId) => {
  try {
    const db = await initDatabase();
    const result = await db.articles
      .find()
      .where('business_id')
      .equals(businessId)
      .exec();
    return result;
  } catch (error) {
    console.error('Error fetching articles:', error);
    throw error;
  }
};

export const getAllBusinesses = async () => {
  try {
    const db = await initDatabase();
    const result = await db.businesses.find().exec();
    return result;
  } catch (error) {
    console.error('Error fetching businesses:', error);
    throw error;
  }
};

export const getBusinessById = async (businessId) => {
  try {
    const db = await initDatabase();
    const result = await db.businesses
      .findOne()
      .where('id')
      .equals(businessId)
      .exec();
    return result;
  } catch (error) {
    console.error('Error fetching business by ID:', error);
    throw error;
  }
};

export const getArticleById = async (articleId) => {
  try {
    const db = await initDatabase();
    const result = await db.articles
      .findOne()
      .where('id')
      .equals(articleId)
      .exec();
    return result;
  } catch (error) {
    console.error('Error fetching article by ID:', error);
    throw error;
  }
};

// Get sync status (simplified)
export const getSyncStatus = () => {
  return {
    isOnline,
    businessSyncActive: businessReplication !== null,
    articleSyncActive: articleReplication !== null,
    currentUrl: COUCHDB_CONFIG.currentUrl
  };
};

// Get storage stats
export const getStorageStats = async () => {
  try {
    const businessesData = await AsyncStorage.getItem(BUSINESSES_KEY);
    const articlesData = await AsyncStorage.getItem(ARTICLES_KEY);
    
    const businesses = businessesData ? JSON.parse(businessesData) : [];
    const articles = articlesData ? JSON.parse(articlesData) : [];
    
    return {
      businesses: businesses.length,
      articles: articles.length,
      syncStatus: getSyncStatus()
    };
  } catch (error) {
    console.error('Error getting storage stats:', error);
    return { businesses: 0, articles: 0, syncStatus: getSyncStatus() };
  }
};