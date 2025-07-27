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
let syncEnabled = true;

// Auto-detect working CouchDB URL with improved error handling
const detectCouchDBUrl = async () => {
  console.log('🔍 Auto-detecting CouchDB URL...');
  
  // Check if we have a previously working URL
  const savedUrl = await AsyncStorage.getItem(COUCHDB_URL_KEY);
  if (savedUrl) {
    console.log('📋 Trying saved URL:', savedUrl);
    if (await testCouchDBUrl(savedUrl)) {
      COUCHDB_CONFIG.currentUrl = savedUrl;
      return savedUrl;
    }
  }

  // Test each possible URL with faster timeout for production
  for (const url of COUCHDB_CONFIG.possibleUrls) {
    console.log('🔍 Testing URL:', url);
    if (await testCouchDBUrl(url)) {
      console.log('✅ Found working CouchDB URL:', url);
      COUCHDB_CONFIG.currentUrl = url;
      // Save working URL for future use
      await AsyncStorage.setItem(COUCHDB_URL_KEY, url);
      return url;
    }
  }

  console.log('❌ No working CouchDB URL found');
  return null;
};

// Test a specific CouchDB URL with faster timeout
const testCouchDBUrl = async (url) => {
  try {
    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COUCHDB_CONFIG.timeout);

    // Remove any trailing slash and test root endpoint
    const cleanUrl = url.replace(/\/$/, '');
    const response = await customFetch(`${cleanUrl}/`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log(`✅ CouchDB accessible at ${cleanUrl}`);
      return true;
    } else {
      console.log(`❌ CouchDB returned ${response.status} at ${cleanUrl}`);
      return false;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`⏱️ Connection timeout for ${url}`);
    } else {
      console.log(`❌ Connection failed for ${url}:`, error.message);
    }
    return false;
  }
};

export const initDatabase = async () => {
  if (dbInstance) return dbInstance;

  console.log('🔧 Creating RxDB with Memory + AsyncStorage + CouchDB sync...');
  
  try {
    const db = await createRxDatabase({
      name: DB_NAME,
      storage: getRxStorageMemory(),
      multiInstance: false,
      ignoreDuplicate: true,
    });

    await db.addCollections({
      businesses: { 
        schema: businessSchema
      },
      articles: {
        schema: articleSchema
      }
    });

    // Load persisted data into memory database
    await loadPersistedData(db);

    // Auto-detect CouchDB URL and setup network monitoring
    await setupNetworkMonitoring(db);

    console.log('✅ DB ready with Memory + AsyncStorage + CouchDB sync');
    
    dbInstance = db;
    return db;
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
};

// Setup network monitoring with auto-detection
const setupNetworkMonitoring = async (db) => {
  try {
    // Check initial network status
    const netInfo = await NetInfo.fetch();
    isOnline = netInfo.isConnected;
    console.log('📡 Initial network status:', isOnline ? 'Online' : 'Offline');

    // Try to detect CouchDB URL if online
    if (isOnline && syncEnabled) {
      const workingUrl = await detectCouchDBUrl();
      if (workingUrl) {
        await startSync(db);
      } else {
        console.warn('⚠️ No accessible CouchDB server found');
      }
    }

    // Monitor network changes
    NetInfo.addEventListener(state => {
      const wasOffline = !isOnline;
      isOnline = state.isConnected;
      
      console.log('📡 Network status changed:', isOnline ? 'Online' : 'Offline');
      
      if (wasOffline && isOnline && syncEnabled) {
        console.log('🔄 Coming back online - detecting CouchDB...');
        detectCouchDBUrl().then(workingUrl => {
          if (workingUrl) {
            startSync(db);
          }
        });
      } else if (!isOnline) {
        console.log('📱 Going offline - stopping sync...');
        stopSync();
      }
    });
  } catch (error) {
    console.error('❌ Error setting up network monitoring:', error);
  }
};

// Start bidirectional sync with auto-detected CouchDB URL
const startSync = async (db) => {
  if (!isOnline || !syncEnabled) {
    console.log('📱 Cannot start sync - offline or sync disabled');
    return;
  }

  if (!COUCHDB_CONFIG.currentUrl) {
    console.log('📱 No CouchDB URL available for sync');
    return;
  }

  try {
    // Stop existing replications first
    stopSync();

    console.log('🔄 Starting CouchDB sync with:', COUCHDB_CONFIG.currentUrl);

    // Create custom fetch with authentication
    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    // FIXED: Ensure URLs end with trailing slash
    const baseUrl = COUCHDB_CONFIG.currentUrl.replace(/\/+$/, '');
    const businessUrl = baseUrl + '/businesses/';
    const articleUrl = baseUrl + '/articles/';
    
    console.log('🔍 Base URL:', baseUrl);
    console.log('🔍 Business URL:', businessUrl);
    console.log('🔍 Article URL:', articleUrl);

    // Test database existence before starting replication
    console.log('🔍 Testing database existence...');
    try {
      const businessDbTest = await customFetch(businessUrl);
      const articleDbTest = await customFetch(articleUrl);
      
      if (!businessDbTest.ok) {
        console.error(`❌ Business database not found: ${businessDbTest.status}`);
        throw new Error(`Business database does not exist`);
      }
      
      if (!articleDbTest.ok) {
        console.error(`❌ Article database not found: ${articleDbTest.status}`);
        throw new Error(`Article database does not exist`);
      }
      
      console.log('✅ Both databases exist, proceeding with replication...');
    } catch (dbTestError) {
      console.error('❌ Database existence test failed:', dbTestError.message);
      throw dbTestError;
    }

    // Setup businesses replication
    console.log('🔄 Setting up business replication...');
    businessReplication = replicateCouchDB({
      replicationIdentifier: 'business-replication',
      collection: db.businesses,
      url: businessUrl,
      live: true,
      fetch: customFetch,
      pull: {
        batchSize: 10
      },
      push: {
        batchSize: 10
      }
    });

    // Setup articles replication
    console.log('🔄 Setting up article replication...');
    articleReplication = replicateCouchDB({
      replicationIdentifier: 'article-replication',
      collection: db.articles,
      url: articleUrl,
      live: true,
      fetch: customFetch,
      pull: {
        batchSize: 10
      },
      push: {
        batchSize: 10
      }
    });

    // Enhanced error handling for businesses
    if (businessReplication && businessReplication.error$) {
      console.log('✅ Business replication setup complete');
      
      businessReplication.error$.subscribe(error => {
        console.error('❌ Business sync error:', error);
      });

      businessReplication.sent$.subscribe(docData => {
        console.log('📤 SUCCESS! Business documents sent to CouchDB:', docData.length);
        // Update AsyncStorage after successful sync
        setTimeout(() => saveBusinessesToStorage(db), 1000);
      });

      // Listen for received documents
      businessReplication.received$.subscribe(docData => {
        console.log('📥 Business documents received from CouchDB:', docData.length);
        // Update AsyncStorage after receiving data
        setTimeout(() => saveBusinessesToStorage(db), 1000);
      });
    }

    // Enhanced error handling for articles
    if (articleReplication && articleReplication.error$) {
      console.log('✅ Article replication setup complete');
      
      articleReplication.error$.subscribe(error => {
        console.error('❌ Article sync error:', error);
      });

      articleReplication.sent$.subscribe(docData => {
        console.log('📤 SUCCESS! Article documents sent to CouchDB:', docData.length);
        // Update AsyncStorage after successful sync
        setTimeout(() => saveArticlesToStorage(db), 1000);
      });

      // Listen for received documents
      articleReplication.received$.subscribe(docData => {
        console.log('📥 Article documents received from CouchDB:', docData.length);
        // Update AsyncStorage after receiving data
        setTimeout(() => saveArticlesToStorage(db), 1000);
      });
    }

    console.log('✅ CouchDB sync setup completed');

  } catch (error) {
    console.error('❌ Error starting sync:', error);
    throw error;
  }
};

// Stop sync replications
const stopSync = () => {
  try {
    if (businessReplication) {
      businessReplication.cancel();
      businessReplication = null;
      console.log('🛑 Business sync stopped');
    }

    if (articleReplication) {
      articleReplication.cancel();
      articleReplication = null;
      console.log('🛑 Article sync stopped');
    }
  } catch (error) {
    console.error('❌ Error stopping sync:', error);
  }
};

// Load persisted data from AsyncStorage into RxDB
const loadPersistedData = async (db) => {
  try {
    // Load businesses
    const businessesData = await AsyncStorage.getItem(BUSINESSES_KEY);
    const businesses = businessesData ? JSON.parse(businessesData) : [];
    
    for (const business of businesses) {
      try {
        await db.businesses.insert(business);
      } catch (error) {
        if (!error.message.includes('already exists') && !error.message.includes('Document with this primary already exists')) {
          console.error('Error inserting business:', error);
        }
      }
    }

    // Load articles
    const articlesData = await AsyncStorage.getItem(ARTICLES_KEY);
    const articles = articlesData ? JSON.parse(articlesData) : [];
    
    for (const article of articles) {
      try {
        await db.articles.insert(article);
      } catch (error) {
        if (!error.message.includes('already exists') && !error.message.includes('Document with this primary already exists')) {
          console.error('Error inserting article:', error);
        }
      }
    }

    console.log(`✅ Loaded ${businesses.length} businesses and ${articles.length} articles from storage`);
  } catch (error) {
    console.error('❌ Error loading persisted data:', error);
  }
};

// Save businesses to AsyncStorage with error handling
const saveBusinessesToStorage = async (db) => {
  try {
    const allBusinesses = await db.businesses.find().exec();
    const businessData = allBusinesses.map(doc => doc.toJSON());
    await AsyncStorage.setItem(BUSINESSES_KEY, JSON.stringify(businessData));
    console.log(`💾 ${businessData.length} businesses saved to storage`);
    return businessData;
  } catch (error) {
    console.error('❌ Error saving businesses:', error);
    return [];
  }
};

// Save articles to AsyncStorage with error handling
const saveArticlesToStorage = async (db) => {
  try {
    const allArticles = await db.articles.find().exec();
    const articleData = allArticles.map(doc => doc.toJSON());
    await AsyncStorage.setItem(ARTICLES_KEY, JSON.stringify(articleData));
    console.log(`💾 ${articleData.length} articles saved to storage`);
    return articleData;
  } catch (error) {
    console.error('❌ Error saving articles:', error);
    return [];
  }
};

// Sync AsyncStorage with RxDB (fixes the old data appearing issue)
export const syncStorageWithDatabase = async () => {
  try {
    console.log('🔄 Syncing AsyncStorage with RxDB...');
    
    const db = await initDatabase();
    
    // Get current data from RxDB (source of truth)
    const businesses = await db.businesses.find().exec();
    const articles = await db.articles.find().exec();
    
    const businessData = businesses.map(doc => doc.toJSON());
    const articleData = articles.map(doc => doc.toJSON());
    
    // Update AsyncStorage to match RxDB
    await AsyncStorage.setItem(BUSINESSES_KEY, JSON.stringify(businessData));
    await AsyncStorage.setItem(ARTICLES_KEY, JSON.stringify(articleData));
    
    console.log(`✅ AsyncStorage synced: ${businessData.length} businesses, ${articleData.length} articles`);
    
    return {
      success: true,
      businesses: businessData.length,
      articles: articleData.length
    };
  } catch (error) {
    console.error('❌ Error syncing storage with database:', error);
    return { success: false, message: error.message };
  }
};

// CRUD Operations with improved sync
export const addBusiness = async (business) => {
  try {
    const db = await initDatabase();
    
    // Ensure document matches schema
    const businessDoc = {
      id: business.id,
      name: business.name,
    };
    
    const inserted = await db.businesses.insert(businessDoc);
    
    // Immediately persist to AsyncStorage
    await saveBusinessesToStorage(db);
    
    console.log('✅ Business inserted and persisted:', inserted.toJSON());
    return inserted;
  } catch (error) {
    console.error('❌ Error adding business:', error);
    throw error;
  }
};

export const addArticle = async (article) => {
  try {
    const db = await initDatabase();
    
    const inserted = await db.articles.insert(article);
    
    // Immediately persist to AsyncStorage
    await saveArticlesToStorage(db);
    
    console.log('✅ Article inserted and persisted:', inserted.toJSON());
    return inserted;
  } catch (error) {
    console.error('❌ Error adding article:', error);
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
    
    // Immediately persist to AsyncStorage
    await saveBusinessesToStorage(db);
    
    console.log('✅ Business updated and persisted:', updatedDoc.toJSON());
    return updatedDoc;
  } catch (error) {
    console.error('❌ Error updating business:', error);
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
    
    // Immediately persist to AsyncStorage
    await saveArticlesToStorage(db);
    
    console.log('✅ Article updated and persisted:', updatedDoc.toJSON());
    return updatedDoc;
  } catch (error) {
    console.error('❌ Error updating article:', error);
    throw error;
  }
};

export const deleteBusiness = async (businessDoc) => {
  try {
    console.log('🗑️ Deleting business:', businessDoc.id, businessDoc.name);
    
    await businessDoc.remove();
    
    // Immediately update AsyncStorage
    const db = await initDatabase();
    await saveBusinessesToStorage(db);
    
    console.log('✅ Business deleted and persisted');
    return { success: true };
  } catch (error) {
    console.error('❌ Error deleting business:', error);
    throw error;
  }
};

export const deleteArticleWithSync = async (articleId) => {
  try {
    console.log('🗑️ Starting article deletion with sync:', articleId);
    
    const db = await initDatabase();
    
    const articleDoc = await db.articles
      .findOne()
      .where('id')
      .equals(articleId)
      .exec();
    
    if (!articleDoc) {
      console.log('❌ Article not found:', articleId);
      return false;
    }
    
    const articleName = articleDoc.name;
    console.log('📄 Found article to delete:', articleName);
    
    // Remove from RxDB (this will sync the deletion)
    await articleDoc.remove();
    console.log('✅ Article removed from RxDB');
    
    // IMMEDIATELY update AsyncStorage to reflect the deletion
    await saveArticlesToStorage(db);
    
    // Force a sync if online
    if (isOnline && syncEnabled) {
      console.log('🔄 Forcing sync to propagate deletion...');
      setTimeout(async () => {
        try {
          const syncResult = await forceSyncNow();
          console.log('📤 Deletion sync result:', syncResult.message);
        } catch (syncError) {
          console.error('❌ Sync error after deletion:', syncError);
        }
      }, 500);
    }
    
    console.log(`✅ Article "${articleName}" successfully deleted and storage updated`);
    return true;
    
  } catch (error) {
    console.error('❌ Error in deleteArticleWithSync:', error);
    throw error;
  }
};

// Legacy delete function for compatibility
export const deleteArticleById = async (articleId) => {
  return await deleteArticleWithSync(articleId);
};

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

// Database management functions
export const createCouchDBDatabases = async () => {
  if (!isOnline) {
    return { success: false, message: 'Offline' };
  }

  try {
    const workingUrl = COUCHDB_CONFIG.currentUrl || await detectCouchDBUrl();
    
    if (!workingUrl) {
      return { success: false, message: 'No accessible CouchDB server found' };
    }

    console.log('🔧 Creating/verifying CouchDB databases at:', workingUrl);
    
    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    const cleanUrl = workingUrl.replace(/\/$/, '');

    // Test connection first
    const serverResponse = await customFetch(`${cleanUrl}/`);
    
    if (!serverResponse.ok) {
      throw new Error(`CouchDB server not accessible: ${serverResponse.status}`);
    }

    // Create businesses database
    const businessResponse = await customFetch(
      `${cleanUrl}/${COUCHDB_CONFIG.businessesDB}`,
      { method: 'PUT' }
    );

    if (businessResponse.ok) {
      console.log('✅ Businesses database created');
    } else if (businessResponse.status === 412) {
      console.log('ℹ️ Businesses database already exists');
    }

    // Create articles database
    const articleResponse = await customFetch(
      `${cleanUrl}/${COUCHDB_CONFIG.articlesDB}`,
      { method: 'PUT' }
    );

    if (articleResponse.ok) {
      console.log('✅ Articles database created');
    } else if (articleResponse.status === 412) {
      console.log('ℹ️ Articles database already exists');
    }

    return { success: true, message: `Databases ready at ${workingUrl}` };
  } catch (error) {
    console.error('❌ Error creating CouchDB databases:', error);
    return { success: false, message: error.message };
  }
};

export const getSyncStatus = () => {
  try {
    return {
      isOnline,
      syncEnabled,
      businessSyncActive: businessReplication !== null && !businessReplication.isStopped(),
      articleSyncActive: articleReplication !== null && !articleReplication.isStopped(),
      currentUrl: COUCHDB_CONFIG.currentUrl,
      businessesDB: COUCHDB_CONFIG.businessesDB,
      articlesDB: COUCHDB_CONFIG.articlesDB
    };
  } catch (error) {
    console.error('❌ Error getting sync status:', error);
    return {
      isOnline,
      syncEnabled,
      businessSyncActive: false,
      articleSyncActive: false,
      currentUrl: COUCHDB_CONFIG.currentUrl,
      businessesDB: COUCHDB_CONFIG.businessesDB,
      articlesDB: COUCHDB_CONFIG.articlesDB
    };
  }
};

export const testCouchDBConnectivity = async () => {
  if (!COUCHDB_CONFIG.currentUrl) {
    console.log('🔍 No current URL, attempting auto-detection...');
    const workingUrl = await detectCouchDBUrl();
    return workingUrl !== null;
  }
  return await testCouchDBUrl(COUCHDB_CONFIG.currentUrl);
};

export const forceSyncNow = async () => {
  if (!isOnline) {
    return { success: false, message: 'Offline' };
  }

  try {
    const workingUrl = COUCHDB_CONFIG.currentUrl || await detectCouchDBUrl();
    
    if (!workingUrl) {
      return { success: false, message: 'No accessible CouchDB server found. Check network and server configuration.' };
    }

    const db = await initDatabase();
    await startSync(db);
    return { success: true, message: `Sync started with ${workingUrl}` };
  } catch (error) {
    console.error('❌ Error forcing sync:', error);
    return { success: false, message: error.message };
  }
};

export const setSyncEnabled = (enabled) => {
  syncEnabled = enabled;
  console.log('🔧 Sync', enabled ? 'enabled' : 'disabled');
  
  if (!enabled) {
    stopSync();
  } else if (isOnline) {
    initDatabase().then(db => {
      detectCouchDBUrl().then(workingUrl => {
        if (workingUrl) {
          startSync(db);
        }
      });
    });
  }
};

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
    console.error('❌ Error getting storage stats:', error);
    return { 
      businesses: 0, 
      articles: 0, 
      syncStatus: getSyncStatus() 
    };
  }
};

// Database reset and cleanup functions
export const cleanupAndReset = async () => {
  try {
    console.log('🧹 Starting database cleanup...');
    
    stopSync();
    
    await AsyncStorage.removeItem(BUSINESSES_KEY);
    await AsyncStorage.removeItem(ARTICLES_KEY);
    await AsyncStorage.removeItem(COUCHDB_URL_KEY);
    
    if (dbInstance) {
      await dbInstance.destroy();
      dbInstance = null;
    }
    
    console.log('✅ Local database cleaned up');
    return { success: true, message: 'Local database cleaned up successfully' };
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    return { success: false, message: error.message };
  }
};

export const deleteCouchDBDatabases = async () => {
  try {
    const workingUrl = COUCHDB_CONFIG.currentUrl || await detectCouchDBUrl();
    
    if (!workingUrl) {
      return { success: false, message: 'No accessible CouchDB server found' };
    }

    console.log('🗑️ Deleting CouchDB databases...');
    
    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    const cleanUrl = workingUrl.replace(/\/$/, '');

    // Delete businesses database
    try {
      const businessResponse = await customFetch(
        `${cleanUrl}/${COUCHDB_CONFIG.businessesDB}`,
        { method: 'DELETE' }
      );
      console.log('🗑️ Businesses database deleted:', businessResponse.status);
    } catch (error) {
      console.log('ℹ️ Businesses database might not exist');
    }

    // Delete articles database
    try {
      const articleResponse = await customFetch(
        `${cleanUrl}/${COUCHDB_CONFIG.articlesDB}`,
        { method: 'DELETE' }
      );
      console.log('🗑️ Articles database deleted:', articleResponse.status);
    } catch (error) {
      console.log('ℹ️ Articles database might not exist');
    }

    return { success: true, message: 'CouchDB databases deleted successfully' };
  } catch (error) {
    console.error('❌ Error deleting CouchDB databases:', error);
    return { success: false, message: error.message };
  }
};

export const fullDatabaseReset = async () => {
  try {
    console.log('🔄 Starting full database reset...');
    
    const localCleanup = await cleanupAndReset();
    if (!localCleanup.success) {
      throw new Error(`Local cleanup failed: ${localCleanup.message}`);
    }
    
    const couchCleanup = await deleteCouchDBDatabases();
    if (!couchCleanup.success) {
      console.warn(`CouchDB cleanup warning: ${couchCleanup.message}`);
    }
    
    const dbCreation = await createCouchDBDatabases();
    if (!dbCreation.success) {
      throw new Error(`Database creation failed: ${dbCreation.message}`);
    }
    
    await initDatabase();
    
    console.log('✅ Full database reset completed successfully');
    return { success: true, message: 'Full database reset completed successfully' };
  } catch (error) {
    console.error('❌ Full database reset failed:', error);
    return { success: false, message: error.message };
  }
};

export const permanentlyDeleteAllData = async () => {
  try {
    console.log('🧹 Starting permanent deletion of all data...');
    
    stopSync();
    console.log('🛑 Sync stopped');
    
    await AsyncStorage.removeItem(BUSINESSES_KEY);
    await AsyncStorage.removeItem(ARTICLES_KEY);
    await AsyncStorage.removeItem(COUCHDB_URL_KEY);
    console.log('🧹 Local storage cleared');
    
    if (dbInstance) {
      await dbInstance.destroy();
      dbInstance = null;
      console.log('🗑️ Local database destroyed');
    }
    
    const workingUrl = COUCHDB_CONFIG.currentUrl || await detectCouchDBUrl();
    
    if (workingUrl) {
      console.log('🗑️ Deleting CouchDB databases...');
      
      const customFetch = getFetchWithCouchDBAuthorization(
        COUCHDB_CONFIG.username,
        COUCHDB_CONFIG.password
      );

      const cleanUrl = workingUrl.replace(/\/$/, '');

      try {
        const businessResponse = await customFetch(
          `${cleanUrl}/${COUCHDB_CONFIG.businessesDB}`,
          { method: 'DELETE' }
        );
        console.log('🗑️ CouchDB businesses database deleted:', businessResponse.status);
      } catch (error) {
        console.log('ℹ️ Businesses database deletion result:', error.message);
      }

      try {
        const articleResponse = await customFetch(
          `${cleanUrl}/${COUCHDB_CONFIG.articlesDB}`,
          { method: 'DELETE' }
        );
        console.log('🗑️ CouchDB articles database deleted:', articleResponse.status);
      } catch (error) {
        console.log('ℹ️ Articles database deletion result:', error.message);
      }
      
      console.log('⏱️ Waiting before recreating databases...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const recreateResult = await createCouchDBDatabases();
      console.log('🔄 Database recreation result:', recreateResult.message);
    }
    
    await initDatabase();
    console.log('✅ Fresh database initialized');
    
    return { success: true, message: 'All data permanently deleted and databases reset' };
  } catch (error) {
    console.error('❌ Error in permanent deletion:', error);
    return { success: false, message: error.message };
  }
};

export const verifyDatabasesAreEmpty = async () => {
  try {
    const workingUrl = COUCHDB_CONFIG.currentUrl || await detectCouchDBUrl();
    
    if (!workingUrl) {
      return { success: false, message: 'No CouchDB connection available' };
    }

    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    const cleanUrl = workingUrl.replace(/\/$/, '');

    const businessResponse = await customFetch(`${cleanUrl}/${COUCHDB_CONFIG.businessesDB}/_all_docs`);
    const businessData = await businessResponse.json();
    
    const articleResponse = await customFetch(`${cleanUrl}/${COUCHDB_CONFIG.articlesDB}/_all_docs`);
    const articleData = await articleResponse.json();
    
    const businessCount = businessData.total_rows || 0;
    const articleCount = articleData.total_rows || 0;
    
    console.log(`📊 CouchDB contains: ${businessCount} businesses, ${articleCount} articles`);
    
    return {
      success: true,
      message: `CouchDB contains: ${businessCount} businesses, ${articleCount} articles`,
      businessCount,
      articleCount,
      isEmpty: businessCount === 0 && articleCount === 0
    };
  } catch (error) {
    console.error('❌ Error verifying databases:', error);
    return { success: false, message: error.message };
  }
};

export const pushLocalDataToCouchDB = async () => {
  try {
    console.log('🔍 === Push Data Debug Start ===');
    
    const netInfo = await NetInfo.fetch();
    const actualIsOnline = netInfo.isConnected;
    console.log('📡 Fresh network check:', actualIsOnline);
    
    isOnline = actualIsOnline;
    
    if (!actualIsOnline) {
      return { success: false, message: 'Device is offline (fresh check)' };
    }
    
    if (!COUCHDB_CONFIG.currentUrl) {
      console.log('🔍 No current URL, forcing detection...');
      const detectedUrl = await detectCouchDBUrl();
      if (!detectedUrl) {
        return { success: false, message: 'No accessible CouchDB server found after detection attempt' };
      }
      console.log('✅ Detected URL after force check:', detectedUrl);
    }

    const db = await initDatabase();
    
    const businesses = await db.businesses.find().exec();
    const articles = await db.articles.find().exec();
    
    console.log(`📤 Local data to push: ${businesses.length} businesses, ${articles.length} articles`);
    
    if (businesses.length === 0 && articles.length === 0) {
      return { success: true, message: 'No local data to sync' };
    }

    console.log('🔄 Stopping current replications...');
    stopSync();
    
    console.log('🔄 Starting fresh sync...');
    await startSync(db);

    return { success: true, message: `Sync restarted for ${businesses.length + articles.length} documents. Check console for sync progress.` };
  } catch (error) {
    console.error('❌ Error pushing local data:', error);
    return { success: false, message: error.message };
  }
};

// Helper functions
export const getRxDatabase = async () => {
  return await initDatabase();
};

export const clearAllData = async () => {
  try {
    await AsyncStorage.removeItem(BUSINESSES_KEY);
    await AsyncStorage.removeItem(ARTICLES_KEY);
    await AsyncStorage.removeItem(COUCHDB_URL_KEY);
    
    stopSync();
    
    if (dbInstance) {
      await dbInstance.destroy();
      dbInstance = null;
    }
    console.log('🧹 All data cleared');
  } catch (error) {
    console.error('❌ Error clearing data:', error);
  }
};