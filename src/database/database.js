// src/database/database.js
import { createRxDatabase, addRxPlugin } from 'rxdb';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { replicateCouchDB, getFetchWithCouchDBAuthorization } from 'rxdb/plugins/replication-couchdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { articleSchema, businessSchema } from './schemas';
import { config } from '../config/environment';

// Add plugins
addRxPlugin(RxDBQueryBuilderPlugin);

let dbInstance;
const DB_NAME = 'businessapp';

// AsyncStorage keys
const BUSINESSES_KEY = 'businesses_data';
const ARTICLES_KEY = 'articles_data';
const COUCHDB_URL_KEY = 'couchdb_url';

// Multiple CouchDB URL options to try (NO trailing slash)
// const COUCHDB_CONFIG = {
//   // Try multiple URLs in order of preference
//   possibleUrls: [
//     'http://192.168.1.100:5984',
//     'http://192.168.1.101:5984',
//     'http://192.168.0.100:5984',
//     'http://192.168.0.101:5984',
//     'http://10.0.2.2:5984',
//     'http://localhost:5984'
//   ],
//   businessesDB: 'businesses',
//   articlesDB: 'articles',
//   username: 'shani',
//   password: 'shani@123456',
//   currentUrl: null,
//   timeout: 5000 // 5 second timeout for connection tests
// };

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

// Auto-detect working CouchDB URL
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

  // Test each possible URL
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

// Test a specific CouchDB URL
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

// Add these functions to your database.js file

export const updateBusiness = async (businessId, updatedData) => {
  try {
    const db = await initDatabase();
    
    // Find the business document
    const businessDoc = await db.businesses
      .findOne()
      .where('id')
      .equals(businessId)
      .exec();
    
    if (!businessDoc) {
      throw new Error('Business not found');
    }
    
    // Update the document
    await businessDoc.update({
      $set: {
        name: updatedData.name,
        // Add other fields as needed
      }
    });
    
    // Persist to AsyncStorage
    await saveBusinessesToStorage(db);
    
    console.log('✅ Business updated and persisted:', businessDoc.toJSON());
    return businessDoc;
  } catch (error) {
    console.error('❌ Error updating business:', error);
    throw error;
  }
};

export const updateArticleData = async (articleId, updatedData) => {
  try {
    const db = await initDatabase();
    
    // Find the article document
    const articleDoc = await db.articles
      .findOne()
      .where('id')
      .equals(articleId)
      .exec();
    
    if (!articleDoc) {
      throw new Error('Article not found');
    }
    
    // Update the document
    await articleDoc.update({
      $set: {
        name: updatedData.name,
        qty: updatedData.qty,
        selling_price: updatedData.selling_price,
        business_id: updatedData.business_id,
      }
    });
    
    // Persist to AsyncStorage
    await saveArticlesToStorage(db);
    
    console.log('✅ Article updated and persisted:', articleDoc.toJSON());
    return articleDoc;
  } catch (error) {
    console.error('❌ Error updating article:', error);
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

// Test CouchDB connection with current or auto-detected URL
const testCouchDBConnection = async () => {
  if (!COUCHDB_CONFIG.currentUrl) {
    console.log('🔍 No current URL, attempting auto-detection...');
    const workingUrl = await detectCouchDBUrl();
    return workingUrl !== null;
  }

  return await testCouchDBUrl(COUCHDB_CONFIG.currentUrl);
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

    // Setup businesses replication with explicit trailing slash
    console.log('🔄 Setting up business replication...');
    try {
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
      
      console.log('🔍 Business replication object:', businessReplication ? 'Created' : 'Failed');
    } catch (error) {
      console.error('❌ Business replication creation failed:', error);
      throw error;
    }

    // Setup articles replication with explicit trailing slash
    console.log('🔄 Setting up article replication...');
    try {
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
      
      console.log('🔍 Article replication object:', articleReplication ? 'Created' : 'Failed');
    } catch (error) {
      console.error('❌ Article replication creation failed:', error);
      throw error;
    }

    // Enhanced error handling for businesses
    if (businessReplication && businessReplication.error$) {
      console.log('✅ Business replication setup complete');
      
      businessReplication.error$.subscribe(error => {
        console.error('❌ Business sync error:', error);
      });

      businessReplication.sent$.subscribe(docData => {
        console.log('📤 SUCCESS! Business documents sent to CouchDB:', docData.length);
      });
    } else {
      console.error('❌ Business replication object is invalid');
    }

    // Enhanced error handling for articles
    if (articleReplication && articleReplication.error$) {
      console.log('✅ Article replication setup complete');
      
      articleReplication.error$.subscribe(error => {
        console.error('❌ Article sync error:', error);
      });

      articleReplication.sent$.subscribe(docData => {
        console.log('📤 SUCCESS! Article documents sent to CouchDB:', docData.length);
      });
    } else {
      console.error('❌ Article replication object is invalid');
    }

    console.log('✅ CouchDB sync setup completed - check for success messages above');

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

// Enhanced database creation with auto-detected URL
export const createCouchDBDatabases = async () => {
  if (!isOnline) {
    return { success: false, message: 'Offline' };
  }

  try {
    // Ensure we have a working URL
    const workingUrl = COUCHDB_CONFIG.currentUrl || await detectCouchDBUrl();
    
    if (!workingUrl) {
      return { success: false, message: 'No accessible CouchDB server found' };
    }

    console.log('🔧 Creating/verifying CouchDB databases at:', workingUrl);
    
    const customFetch = getFetchWithCouchDBAuthorization(
      COUCHDB_CONFIG.username,
      COUCHDB_CONFIG.password
    );

    // Clean URL to avoid double slashes
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

// Get detailed sync status including current URL
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

// Manual URL detection trigger
export const rediscoverCouchDBUrl = async () => {
  console.log('🔄 Manual CouchDB URL rediscovery triggered...');
  COUCHDB_CONFIG.currentUrl = null;
  await AsyncStorage.removeItem(COUCHDB_URL_KEY);
  return await detectCouchDBUrl();
};

// Test connectivity with current setup
export const testCouchDBConnectivity = async () => {
  return await testCouchDBConnection();
};

// Force sync with URL detection
export const forceSyncNow = async () => {
  if (!isOnline) {
    return { success: false, message: 'Offline' };
  }

  try {
    // Ensure we have a working URL
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

// Manual sync trigger to push local data to CouchDB
export const pushLocalDataToCouchDB = async () => {
  try {
    console.log('🔍 === Push Data Debug Start ===');
    
    // Force check network status
    const netInfo = await NetInfo.fetch();
    const actualIsOnline = netInfo.isConnected;
    console.log('📡 Fresh network check:', actualIsOnline);
    console.log('📡 Stored isOnline:', isOnline);
    
    // Update our internal status
    isOnline = actualIsOnline;
    
    console.log('🔗 Current URL check:', COUCHDB_CONFIG.currentUrl);
    console.log('⚙️ Sync enabled check:', syncEnabled);
    
    if (!actualIsOnline) {
      return { success: false, message: 'Device is offline (fresh check)' };
    }
    
    // Force URL detection if none exists
    if (!COUCHDB_CONFIG.currentUrl) {
      console.log('🔍 No current URL, forcing detection...');
      const detectedUrl = await detectCouchDBUrl();
      if (!detectedUrl) {
        return { success: false, message: 'No accessible CouchDB server found after detection attempt' };
      }
      console.log('✅ Detected URL after force check:', detectedUrl);
    }

    const db = await initDatabase();
    
    // Get all local data
    const businesses = await db.businesses.find().exec();
    const articles = await db.articles.find().exec();
    
    console.log(`📤 Local data to push: ${businesses.length} businesses, ${articles.length} articles`);
    
    // Log the actual documents
    if (businesses.length > 0) {
      console.log('📋 Business documents:', businesses.map(b => ({ id: b.id, name: b.name })));
    }
    if (articles.length > 0) {
      console.log('📋 Article documents:', articles.map(a => ({ id: a.id, name: a.name })));
    }
    
    if (businesses.length === 0 && articles.length === 0) {
      return { success: true, message: 'No local data to sync' };
    }

    // Force restart sync to push data
    console.log('🔄 Stopping current replications...');
    stopSync();
    
    // Wait a moment then restart sync
    console.log('🔄 Starting fresh sync...');
    await startSync(db);

    return { success: true, message: `Sync restarted for ${businesses.length + articles.length} documents. Check console for sync progress.` };
  } catch (error) {
    console.error('❌ Error pushing local data:', error);
    return { success: false, message: error.message };
  }
};

// Enable/disable sync
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

// Save businesses to AsyncStorage
const saveBusinessesToStorage = async (db) => {
  try {
    const allBusinesses = await db.businesses.find().exec();
    const businessData = allBusinesses.map(doc => doc.toJSON());
    await AsyncStorage.setItem(BUSINESSES_KEY, JSON.stringify(businessData));
    console.log('💾 Businesses saved to storage');
  } catch (error) {
    console.error('❌ Error saving businesses:', error);
  }
};

// Save articles to AsyncStorage
const saveArticlesToStorage = async (db) => {
  try {
    const allArticles = await db.articles.find().exec();
    const articleData = allArticles.map(doc => doc.toJSON());
    await AsyncStorage.setItem(ARTICLES_KEY, JSON.stringify(articleData));
    console.log('💾 Articles saved to storage');
  } catch (error) {
    console.error('❌ Error saving articles:', error);
  }
};

export const addArticle = async (article) => {
  try {
    const db = await initDatabase();
    
    // Don't add _id - let RxDB handle the ID mapping
    const inserted = await db.articles.insert(article);
    
    // Persist to AsyncStorage (backup)
    await saveArticlesToStorage(db);
    
    console.log('✅ Article inserted and persisted:', inserted.toJSON());
    
    // Log for debugging
    console.log('🔍 Article document structure:', JSON.stringify(inserted.toJSON(), null, 2));
    
    return inserted;
  } catch (error) {
    console.error('❌ Error adding article:', error);
    throw error;
  }
};

export const addBusiness = async (business) => {
  try {
    const db = await initDatabase();
    
    // Ensure document matches schema (no address field)
    const businessDoc = {
      id: business.id,
      name: business.name,
    };
    
    const inserted = await db.businesses.insert(businessDoc);
    
    // Persist to AsyncStorage (backup)
    await saveBusinessesToStorage(db);
    
    console.log('✅ Business inserted and persisted:', inserted.toJSON());
    
    // Log for debugging
    console.log('🔍 Business document structure:', JSON.stringify(inserted.toJSON(), null, 2));
    
    return inserted;
  } catch (error) {
    console.error('❌ Error adding business:', error);
    throw error;
  }
};

export const updateArticle = async (articleDoc) => {
  try {
    await articleDoc.save();
    
    // Update persistence
    const db = await initDatabase();
    await saveArticlesToStorage(db);
    
    console.log('✅ Article updated and persisted');
  } catch (error) {
    console.error('❌ Error updating article:', error);
    throw error;
  }
};

export const deleteArticle = async (articleDoc) => {
  try {
    await articleDoc.remove();
    
    // Update persistence
    const db = await initDatabase();
    await saveArticlesToStorage(db);
    
    console.log('🗑️ Article deleted and persisted');
  } catch (error) {
    console.error('❌ Error deleting article:', error);
    throw error;
  }
};

export const deleteBusiness = async (businessDoc) => {
  try {
    await businessDoc.remove();
    
    // Update persistence
    const db = await initDatabase();
    await saveBusinessesToStorage(db);
    
    console.log('🗑️ Business deleted and persisted');
  } catch (error) {
    console.error('❌ Error deleting business:', error);
    throw error;
  }
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

// Helper function for backward compatibility
export const getRxDatabase = async () => {
  return await initDatabase();
};

// Clear all data (for testing)
export const clearAllData = async () => {
  try {
    await AsyncStorage.removeItem(BUSINESSES_KEY);
    await AsyncStorage.removeItem(ARTICLES_KEY);
    await AsyncStorage.removeItem(COUCHDB_URL_KEY);
    
    // Stop sync before destroying
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
    console.error('❌ Error getting storage stats:', error);
    return { 
      businesses: 0, 
      articles: 0, 
      syncStatus: getSyncStatus() 
    };
  }
};