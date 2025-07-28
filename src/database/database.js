// src/database/database.js - Hybrid Solution: RxDB + SQLite-Storage
import { createRxDatabase, addRxPlugin } from 'rxdb';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { replicateCouchDB, getFetchWithCouchDBAuthorization } from 'rxdb/plugins/replication-couchdb';

// SQLite for direct storage
import SQLite from 'react-native-sqlite-storage';

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { articleSchema, businessSchema } from './schemas';
import { config } from '../config/environment';

// Add plugins
addRxPlugin(RxDBQueryBuilderPlugin);
addRxPlugin(RxDBUpdatePlugin);

let dbInstance;
let sqliteDB = null;
const DB_NAME = 'businessapp';
const SQLITE_DB_NAME = 'businessapp.db';

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

// Initialize SQLite database
const initSQLiteDB = async () => {
  if (sqliteDB) return sqliteDB;

  try {
    console.log('🔧 Opening SQLite database...');
    
    sqliteDB = await SQLite.openDatabase({
      name: SQLITE_DB_NAME,
      location: 'default',
    });

    // Create tables if they don't exist
    await sqliteDB.executeSql(`
      CREATE TABLE IF NOT EXISTS businesses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await sqliteDB.executeSql(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        qty INTEGER NOT NULL,
        selling_price REAL NOT NULL,
        business_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_id) REFERENCES businesses (id)
      )
    `);

    console.log('✅ SQLite database initialized successfully');
    return sqliteDB;
  } catch (error) {
    console.error('❌ SQLite initialization error:', error);
    throw error;
  }
};

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
    console.log('🔧 Creating RxDB with Memory + SQLite hybrid...');
    
    // Initialize SQLite first
    await initSQLiteDB();
    
    // Create RxDB with memory storage (for reactive queries)
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

    console.log('✅ Hybrid Database initialized successfully (RxDB + SQLite)');

    // Load data from SQLite into RxDB
    await loadFromSQLiteToRxDB(db);
    
    // Setup network monitoring and sync
    await setupNetworkMonitoring(db);

    dbInstance = db;
    return db;
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
};

// Load data from SQLite into RxDB for reactive queries
const loadFromSQLiteToRxDB = async (db) => {
  try {
    const sqlite = await initSQLiteDB();
    
    // Load businesses
    const businessResult = await sqlite.executeSql('SELECT * FROM businesses');
    const businesses = businessResult[0].rows.raw();
    
    for (const business of businesses) {
      try {
        await db.businesses.insert(business);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.error('Error loading business to RxDB:', error);
        }
      }
    }

    // Load articles
    const articleResult = await sqlite.executeSql('SELECT * FROM articles');
    const articles = articleResult[0].rows.raw();
    
    for (const article of articles) {
      try {
        await db.articles.insert(article);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.error('Error loading article to RxDB:', error);
        }
      }
    }

    console.log(`✅ Loaded ${businesses.length} businesses and ${articles.length} articles from SQLite to RxDB`);
  } catch (error) {
    console.error('❌ Error loading from SQLite to RxDB:', error);
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
    console.error('❌ Error setting up network monitoring:', error);
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

    // Auto-save to SQLite on sync
    if (businessReplication) {
      businessReplication.sent$.subscribe(() => {
        setTimeout(() => saveBusinessesToSQLite(db), 1000);
      });
      businessReplication.received$.subscribe(() => {
        setTimeout(() => saveBusinessesToSQLite(db), 1000);
      });
    }

    if (articleReplication) {
      articleReplication.sent$.subscribe(() => {
        setTimeout(() => saveArticlesToSQLite(db), 1000);
      });
      articleReplication.received$.subscribe(() => {
        setTimeout(() => saveArticlesToSQLite(db), 1000);
      });
    }

    console.log('✅ Hybrid sync started successfully');

  } catch (error) {
    console.error('❌ Error starting sync:', error);
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
    console.error('❌ Error stopping sync:', error);
  }
};

// Save businesses to SQLite
const saveBusinessesToSQLite = async (db) => {
  try {
    const sqlite = await initSQLiteDB();
    const allBusinesses = await db.businesses.find().exec();
    
    // Clear and repopulate
    await sqlite.executeSql('DELETE FROM businesses');
    
    for (const business of allBusinesses) {
      const data = business.toJSON();
      await sqlite.executeSql(
        'INSERT OR REPLACE INTO businesses (id, name) VALUES (?, ?)',
        [data.id, data.name]
      );
    }
    
    console.log(`💾 ${allBusinesses.length} businesses saved to SQLite`);
  } catch (error) {
    console.error('❌ Error saving businesses to SQLite:', error);
  }
};

// Save articles to SQLite
const saveArticlesToSQLite = async (db) => {
  try {
    const sqlite = await initSQLiteDB();
    const allArticles = await db.articles.find().exec();
    
    // Clear and repopulate
    await sqlite.executeSql('DELETE FROM articles');
    
    for (const article of allArticles) {
      const data = article.toJSON();
      await sqlite.executeSql(
        'INSERT OR REPLACE INTO articles (id, name, qty, selling_price, business_id) VALUES (?, ?, ?, ?, ?)',
        [data.id, data.name, data.qty, data.selling_price, data.business_id]
      );
    }
    
    console.log(`💾 ${allArticles.length} articles saved to SQLite`);
  } catch (error) {
    console.error('❌ Error saving articles to SQLite:', error);
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
    await customFetch(`${cleanUrl}/${COUCHDB_CONFIG.businessesDB}`, { method: 'PUT' });
    await customFetch(`${cleanUrl}/${COUCHDB_CONFIG.articlesDB}`, { method: 'PUT' });
  } catch (error) {
    console.error('❌ Error creating CouchDB databases:', error);
  }
};

// Sync function for compatibility
export const syncStorageWithDatabase = async () => {
  try {
    const db = await initDatabase();
    await saveBusinessesToSQLite(db);
    await saveArticlesToSQLite(db);
    
    const businesses = await db.businesses.find().exec();
    const articles = await db.articles.find().exec();
    
    return { success: true, businesses: businesses.length, articles: articles.length };
  } catch (error) {
    console.error('❌ Error syncing storage with database:', error);
    return { success: false, message: error.message };
  }
};

// CRUD Operations
export const addBusiness = async (business) => {
  try {
    const db = await initDatabase();
    const sqlite = await initSQLiteDB();
    
    const businessDoc = {
      id: business.id,
      name: business.name,
    };
    
    // Add to RxDB (for reactive queries)
    const inserted = await db.businesses.insert(businessDoc);
    
    // Add to SQLite (for persistence)
    await sqlite.executeSql(
      'INSERT OR REPLACE INTO businesses (id, name) VALUES (?, ?)',
      [business.id, business.name]
    );
    
    console.log('✅ Business added to both RxDB and SQLite:', inserted.toJSON());
    return inserted;
  } catch (error) {
    console.error('❌ Error adding business:', error);
    throw error;
  }
};

export const addArticle = async (article) => {
  try {
    const db = await initDatabase();
    const sqlite = await initSQLiteDB();
    
    // Add to RxDB (for reactive queries)
    const inserted = await db.articles.insert(article);
    
    // Add to SQLite (for persistence)
    await sqlite.executeSql(
      'INSERT OR REPLACE INTO articles (id, name, qty, selling_price, business_id) VALUES (?, ?, ?, ?, ?)',
      [article.id, article.name, article.qty, article.selling_price, article.business_id]
    );
    
    console.log('✅ Article added to both RxDB and SQLite:', inserted.toJSON());
    return inserted;
  } catch (error) {
    console.error('❌ Error adding article:', error);
    throw error;
  }
};

export const updateBusiness = async (businessId, updatedData) => {
  try {
    const db = await initDatabase();
    const sqlite = await initSQLiteDB();
    
    const businessDoc = await db.businesses
      .findOne()
      .where('id')
      .equals(businessId)
      .exec();
    
    if (!businessDoc) {
      throw new Error('Business not found');
    }
    
    // Update RxDB
    const updatedDoc = await businessDoc.modify(docData => {
      docData.name = updatedData.name;
      return docData;
    });
    
    // Update SQLite
    await sqlite.executeSql(
      'UPDATE businesses SET name = ? WHERE id = ?',
      [updatedData.name, businessId]
    );
    
    console.log('✅ Business updated in both RxDB and SQLite:', updatedDoc.toJSON());
    return updatedDoc;
  } catch (error) {
    console.error('❌ Error updating business:', error);
    throw error;
  }
};

export const updateArticleData = async (articleId, updatedData) => {
  try {
    const db = await initDatabase();
    const sqlite = await initSQLiteDB();
    
    const articleDoc = await db.articles
      .findOne()
      .where('id')
      .equals(articleId)
      .exec();
    
    if (!articleDoc) {
      throw new Error('Article not found');
    }
    
    // Update RxDB
    const updatedDoc = await articleDoc.modify(docData => {
      docData.name = updatedData.name;
      docData.qty = updatedData.qty;
      docData.selling_price = updatedData.selling_price;
      docData.business_id = updatedData.business_id;
      return docData;
    });
    
    // Update SQLite
    await sqlite.executeSql(
      'UPDATE articles SET name = ?, qty = ?, selling_price = ?, business_id = ? WHERE id = ?',
      [updatedData.name, updatedData.qty, updatedData.selling_price, updatedData.business_id, articleId]
    );
    
    console.log('✅ Article updated in both RxDB and SQLite:', updatedDoc.toJSON());
    return updatedDoc;
  } catch (error) {
    console.error('❌ Error updating article:', error);
    throw error;
  }
};

export const deleteBusiness = async (businessDoc) => {
  try {
    const sqlite = await initSQLiteDB();
    
    // Delete from RxDB
    await businessDoc.remove();
    
    // Delete from SQLite
    await sqlite.executeSql('DELETE FROM businesses WHERE id = ?', [businessDoc.id]);
    
    console.log('✅ Business deleted from both RxDB and SQLite');
    return { success: true };
  } catch (error) {
    console.error('❌ Error deleting business:', error);
    throw error;
  }
};

export const deleteArticleWithSync = async (articleId) => {
  try {
    const db = await initDatabase();
    const sqlite = await initSQLiteDB();
    
    const articleDoc = await db.articles
      .findOne()
      .where('id')
      .equals(articleId)
      .exec();
    
    if (!articleDoc) {
      return false;
    }
    
    // Delete from RxDB
    await articleDoc.remove();
    
    // Delete from SQLite
    await sqlite.executeSql('DELETE FROM articles WHERE id = ?', [articleId]);
    
    console.log('✅ Article deleted from both RxDB and SQLite');
    return true;
  } catch (error) {
    console.error('❌ Error in deleteArticleWithSync:', error);
    throw error;
  }
};

// Read operations (use RxDB for reactive queries)
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
    console.error('❌ Error fetching articles:', error);
    throw error;
  }
};

export const getAllBusinesses = async () => {
  try {
    const db = await initDatabase();
    const result = await db.businesses.find().exec();
    return result;
  } catch (error) {
    console.error('❌ Error fetching businesses:', error);
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
    console.error('❌ Error fetching business by ID:', error);
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
    console.error('❌ Error fetching article by ID:', error);
    throw error;
  }
};

// Status functions
export const getSyncStatus = () => {
  return {
    isOnline,
    businessSyncActive: businessReplication !== null,
    articleSyncActive: articleReplication !== null,
    currentUrl: COUCHDB_CONFIG.currentUrl,
    storageType: 'Hybrid (RxDB + SQLite)'
  };
};

export const getStorageStats = async () => {
  try {
    const db = await initDatabase();
    const businesses = await db.businesses.find().exec();
    const articles = await db.articles.find().exec();
    
    return {
      businesses: businesses.length,
      articles: articles.length,
      syncStatus: getSyncStatus(),
      storageType: 'Hybrid (RxDB + SQLite)'
    };
  } catch (error) {
    console.error('❌ Error getting storage stats:', error);
    return { businesses: 0, articles: 0, syncStatus: getSyncStatus() };
  }
};