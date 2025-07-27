import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addBusiness,
  getAllBusinesses,
  initDatabase,
  deleteBusiness,
  getSyncStatus,
  forceSyncNow,
  getStorageStats,
  setSyncEnabled,
  createCouchDBDatabases,
  pushLocalDataToCouchDB,
  testCouchDBConnectivity,
  fullDatabaseReset,
  cleanupAndReset,
  deleteCouchDBDatabases,
  permanentlyDeleteAllData,
  verifyDatabasesAreEmpty,
  syncStorageWithDatabase,
  clearAllData
} from '../database/database';
import { v4 as uuidv4 } from 'uuid';
import NetInfo from '@react-native-community/netinfo';
import EditBusinessModal from '../components/EditBusinessModal';
import { getFetchWithCouchDBAuthorization } from 'rxdb/plugins/replication-couchdb';

const BusinessScreen = () => {
  const [name, setName] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatusState] = useState({
    isOnline: false,
    syncEnabled: true,
    businessSyncActive: false,
    articleSyncActive: false,
    currentUrl: '',
    businessesDB: '',
    articlesDB: ''
  });
  const [storageStats, setStorageStats] = useState({
    businesses: 0,
    articles: 0
  });
  const [refreshing, setRefreshing] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState(null);

  const addDebugLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev.slice(-20), `${timestamp}: ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      addDebugLog('Starting app initialization...');

      // Initialize database
      await initDatabase();
      setDbReady(true);
      addDebugLog('Database initialized successfully');

      // Setup network monitoring
      const unsubscribe = NetInfo.addEventListener(state => {
        setIsOnline(state.isConnected);
        addDebugLog(`Network status: ${state.isConnected ? 'Online' : 'Offline'}`);

        // Update sync status when network changes
        setTimeout(updateSyncStatus, 1000);
      });

      // Check initial connectivity and create databases
      const netInfo = await NetInfo.fetch();
      if (netInfo.isConnected) {
        addDebugLog('Device is online, testing CouchDB connectivity...');
        const isReachable = await testCouchDBConnectivity();
        if (isReachable) {
          addDebugLog('CouchDB is reachable, creating databases...');
          const dbResult = await createCouchDBDatabases();
          addDebugLog(`Database creation result: ${dbResult.success ? 'Success' : dbResult.message}`);
        } else {
          addDebugLog('CouchDB server is not reachable');
        }
      }

      // Fetch initial data with proper sync
      await fetchBusinessesWithSync();
      await updateSyncStatus();

      // Update sync status periodically
      const statusInterval = setInterval(updateSyncStatus, 5000);

      return () => {
        unsubscribe();
        clearInterval(statusInterval);
      };
    } catch (error) {
      const errorMsg = `App initialization failed: ${error.message}`;
      addDebugLog(errorMsg);
      console.error('❌ Error initializing app:', error);
      Alert.alert('Error', errorMsg);
    }
  };

  const updateSyncStatus = async () => {
    try {
      const status = getSyncStatus();
      const stats = await getStorageStats();
      setSyncStatusState(status);
      setStorageStats(stats);
    } catch (error) {
      addDebugLog(`Error updating sync status: ${error.message}`);
      console.error('❌ Error updating sync status:', error);
    }
  };

  // Fixed fetchBusinesses to ensure proper sync with AsyncStorage
  const fetchBusinessesWithSync = async () => {
    try {
      addDebugLog('🔄 Fetching businesses with sync...');

      // First, sync AsyncStorage with RxDB to ensure consistency
      await syncStorageWithDatabase();

      // Then fetch from RxDB
      const result = await getAllBusinesses();
      const list = result.map(doc => doc.toJSON());

      addDebugLog(`✅ Fetched ${list.length} businesses from database`);
      setBusinesses(list);

      return list;
    } catch (error) {
      addDebugLog(`❌ Error fetching businesses: ${error.message}`);
      console.error('❌ Error fetching businesses:', error);
      setBusinesses([]); // Clear on error
      throw error;
    }
  };

  // Simplified fetchBusinesses for backward compatibility
  const fetchBusinesses = async () => {
    return await fetchBusinessesWithSync();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    addDebugLog('🔄 Manual refresh triggered - comprehensive sync');

    try {
      // Step 1: Force sync first to get latest data from CouchDB
      if (isOnline && syncStatus.syncEnabled) {
        addDebugLog('📡 Forcing sync to get latest data...');
        const syncResult = await forceSyncNow();
        if (syncResult.success) {
          addDebugLog('✅ Sync completed successfully');
          // Wait for sync to settle
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          addDebugLog(`⚠️ Sync failed: ${syncResult.message}`);
        }
      }

      // Step 2: Sync storage with database
      await syncStorageWithDatabase();

      // Step 3: Refresh local data from database
      addDebugLog('📊 Fetching fresh data from database...');
      await fetchBusinessesWithSync();

      // Step 4: Update sync status
      await updateSyncStatus();

      // Step 5: Verify data consistency
      const stats = await getStorageStats();
      addDebugLog(`📈 Data refreshed: ${stats.businesses} businesses, ${stats.articles} articles`);

      addDebugLog('✅ Comprehensive refresh completed');

    } catch (error) {
      const errorMsg = `Refresh error: ${error.message}`;
      addDebugLog(errorMsg);
      console.error('❌ Error in comprehensive refresh:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const onRefreshFromServer = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Cannot refresh from server while offline');
      return;
    }

    setRefreshing(true);
    addDebugLog('🌐 Refreshing data from CouchDB server only...');

    try {
      // Step 1: Clear local cache to force fresh pull
      addDebugLog('🧹 Clearing local cache...');

      const db = await initDatabase();

      // Clear local RxDB data
      const businessDocs = await db.businesses.find().exec();
      const articleDocs = await db.articles.find().exec();

      for (const doc of businessDocs) {
        await doc.remove();
      }
      for (const doc of articleDocs) {
        await doc.remove();
      }

      // Clear AsyncStorage cache
      await AsyncStorage.removeItem('businesses_data');
      await AsyncStorage.removeItem('articles_data');

      addDebugLog('✅ Local cache cleared');

      // Step 2: Force pull from CouchDB
      addDebugLog('📥 Pulling fresh data from CouchDB...');
      const syncResult = await forceSyncNow();

      if (syncResult.success) {
        addDebugLog('✅ Fresh data pulled from server');

        // Wait for sync to complete
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Refresh UI
        await fetchBusinessesWithSync();
        await updateSyncStatus();

        Alert.alert('Success', 'Data refreshed from server successfully');
      } else {
        addDebugLog(`❌ Server refresh failed: ${syncResult.message}`);
        Alert.alert('Error', `Failed to refresh from server: ${syncResult.message}`);
      }

    } catch (error) {
      const errorMsg = `Server refresh error: ${error.message}`;
      addDebugLog(errorMsg);
      Alert.alert('Error', errorMsg);
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddBusiness = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a business name');
      return;
    }

    if (!dbReady) {
      Alert.alert('Error', 'Database not ready. Please wait...');
      return;
    }

    try {
      const businessData = {
        id: uuidv4(),
        name: name.trim(),
      };

      addDebugLog(`Adding business: ${businessData.name}`);
      await addBusiness(businessData);
      addDebugLog(`Business added successfully: ${businessData.id}`);

      setName('');

      // Ensure proper refresh after adding
      await fetchBusinessesWithSync();
      await updateSyncStatus();

      const syncMessage = isOnline && syncStatus.syncEnabled ?
        ' (Should sync to server...)' :
        ' (Will sync when online)';

      Alert.alert(
        'Success',
        `Business "${businessData.name}" added successfully!${syncMessage}`
      );
    } catch (error) {
      const errorMsg = `Failed to add business: ${error.message}`;
      addDebugLog(errorMsg);
      console.error('❌ Error adding business:', error);
      Alert.alert('Error', errorMsg);
    }
  };

  const handleEditBusiness = (business) => {
    setSelectedBusiness(business);
    setEditModalVisible(true);
  };

  const handleBusinessUpdated = async (updatedBusiness) => {
    // Refresh the businesses list with proper sync
    await fetchBusinessesWithSync();
    // Update storage stats
    await updateSyncStatus();
  };

  const handleDelete = async (id) => {
    Alert.alert(
      'Delete Business',
      'Are you sure you want to delete this business?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              addDebugLog(`Deleting business: ${id}`);
              const db = await initDatabase();
              const doc = await db.businesses.findOne({ selector: { id } }).exec();
              if (doc) {
                await deleteBusiness(doc);
                addDebugLog(`Business deleted successfully: ${id}`);
                await fetchBusinessesWithSync();
                await updateSyncStatus();
              }
            } catch (error) {
              const errorMsg = `Failed to delete business: ${error.message}`;
              addDebugLog(errorMsg);
              console.error('❌ Error deleting business:', error);
              Alert.alert('Error', errorMsg);
            }
          }
        }
      ]
    );
  };

  // Debug functions
  const handlePermanentReset = async () => {
    Alert.alert(
      '⚠️ PERMANENT DELETION',
      'This will PERMANENTLY DELETE ALL DATA from both local storage and CouchDB servers. This action cannot be undone!\n\nAre you absolutely sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'DELETE EVERYTHING',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final Confirmation',
              'Last chance! This will delete ALL businesses and articles permanently. Continue?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete All',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      addDebugLog('Starting permanent deletion of all data...');

                      const result = await permanentlyDeleteAllData();

                      if (result.success) {
                        addDebugLog('✅ All data permanently deleted');
                        Alert.alert('Complete', 'All data has been permanently deleted from everywhere.');

                        // Reset UI state
                        setBusinesses([]);
                        setDbReady(true);
                        await updateSyncStatus();

                      } else {
                        addDebugLog(`❌ Permanent deletion failed: ${result.message}`);
                        Alert.alert('Error', `Failed to delete all data: ${result.message}`);
                      }
                    } catch (error) {
                      const errorMsg = `Permanent deletion error: ${error.message}`;
                      addDebugLog(errorMsg);
                      Alert.alert('Error', errorMsg);
                    }
                  }
                }
              ]
            );
          }
        }
      ]
    );
  };

  const handleVerifyEmpty = async () => {
    try {
      addDebugLog('Verifying database contents...');

      const result = await verifyDatabasesAreEmpty();

      if (result.success) {
        const message = `${result.message}\n\nDatabases are ${result.isEmpty ? 'EMPTY ✅' : 'NOT EMPTY ❌'}`;
        addDebugLog(result.message);
        Alert.alert('Database Status', message);
      } else {
        addDebugLog(`Verification failed: ${result.message}`);
        Alert.alert('Error', `Verification failed: ${result.message}`);
      }
    } catch (error) {
      const errorMsg = `Verification error: ${error.message}`;
      addDebugLog(errorMsg);
      Alert.alert('Error', errorMsg);
    }
  };

  const handleCheckLocalStorage = async () => {
    try {
      const businessesData = await AsyncStorage.getItem('businesses_data');
      const articlesData = await AsyncStorage.getItem('articles_data');

      const businesses = businessesData ? JSON.parse(businessesData) : [];
      const articles = articlesData ? JSON.parse(articlesData) : [];

      const message = `AsyncStorage Contents:\n\nBusinesses: ${businesses.length}\nArticles: ${articles.length}\n\nBusiness Names:\n${businesses.map(b => `• ${b.name}`).join('\n')}\n\nArticle Names:\n${articles.map(a => `• ${a.name}`).join('\n')}`;

      addDebugLog(`📋 AsyncStorage: ${businesses.length} businesses, ${articles.length} articles`);
      Alert.alert('Local Storage Contents', message);

    } catch (error) {
      Alert.alert('Error', `Failed to check local storage: ${error.message}`);
    }
  };

  // Add other handler functions here (handlePushData, handleTestConnectivity, etc.)
  const handlePushData = async () => {
    try {
      addDebugLog('Manually pushing local data to CouchDB...');
      const result = await pushLocalDataToCouchDB();
      if (result.success) {
        addDebugLog(`Push data result: ${result.message}`);
        Alert.alert('Push Data', result.message);
      } else {
        addDebugLog(`Push data failed: ${result.message}`);
        Alert.alert('Error', result.message);
      }
    } catch (error) {
      const errorMsg = `Push data error: ${error.message}`;
      addDebugLog(errorMsg);
      console.log('❌ Error pushing data:', error);
      Alert.alert('Error', errorMsg);
    }
  };

  const handleTestConnectivity = async () => {
    addDebugLog('Testing CouchDB connectivity manually...');

    if (!isOnline) {
      Alert.alert('Offline', 'Cannot test connectivity while offline.');
      return;
    }

    try {
      const isReachable = await testCouchDBConnectivity();
      const message = isReachable ?
        'CouchDB server is reachable!' :
        'CouchDB server is not reachable. Check IP address and server status.';

      addDebugLog(`Connectivity test result: ${message}`);
      Alert.alert('Connectivity Test', message);
    } catch (error) {
      const errorMsg = `Connectivity test failed: ${error.message}`;
      addDebugLog(errorMsg);
      Alert.alert('Error', errorMsg);
    }
  };

  const handleForceWorkingURL = async () => {
    const workingURL = 'http://192.168.1.100:5984';

    Alert.alert(
      'Force Working URL Test',
      `Testing the URL that works in your browser: ${workingURL}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Test Now',
          onPress: async () => {
            try {
              addDebugLog(`🔍 Testing known working URL: ${workingURL}`);

              // Test basic fetch
              const response = await fetch(workingURL, {
                method: 'GET',
                timeout: 10000,
              });

              if (response.ok) {
                const data = await response.text();
                addDebugLog(`✅ Basic fetch SUCCESS: ${workingURL}`);

                // Test with CouchDB auth
                const customFetch = getFetchWithCouchDBAuthorization('shani', 'shani@123456');
                const authResponse = await customFetch(workingURL);

                if (authResponse.ok) {
                  addDebugLog(`✅ Authenticated fetch SUCCESS: ${workingURL}`);

                  // Try to manually set this URL and test sync
                  await AsyncStorage.setItem('couchdb_url', workingURL);

                  Alert.alert(
                    'Success!',
                    `✅ Both basic and authenticated requests work!\n\nURL: ${workingURL}\n\nResponse preview: ${data.substring(0, 100)}...\n\nTrying to force sync now...`
                  );

                  // Force a sync test
                  setTimeout(async () => {
                    const syncResult = await forceSyncNow();
                    addDebugLog(`Forced sync result: ${syncResult.message}`);
                  }, 1000);

                } else {
                  addDebugLog(`❌ Authenticated fetch failed: ${authResponse.status}`);
                  Alert.alert('Auth Failed', `Basic fetch worked but authentication failed.\n\nStatus: ${authResponse.status}\n\nCheck username/password.`);
                }
              } else {
                addDebugLog(`❌ Basic fetch failed: ${response.status}`);
                Alert.alert('Failed', `HTTP ${response.status} from ${workingURL}\n\nEven though it works in browser.`);
              }
            } catch (error) {
              addDebugLog(`❌ Force URL test error: ${error.message}`);
              Alert.alert('Error', `Failed to connect to ${workingURL}\n\nError: ${error.message}\n\nThis is strange since it works in your browser.`);
            }
          }
        }
      ]
    );
  };

  const handleForceSync = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Cannot sync while offline. Please check your internet connection.');
      return;
    }

    try {
      addDebugLog('Starting manual sync...');

      // Test connectivity first
      const isReachable = await testCouchDBConnectivity();
      if (!isReachable) {
        Alert.alert('Connection Error', 'CouchDB server is not reachable. Please check your network settings.');
        return;
      }

      // Ensure databases exist
      const dbResult = await createCouchDBDatabases();
      if (!dbResult.success) {
        Alert.alert('Database Error', `Failed to verify databases: ${dbResult.message}`);
        return;
      }

      const result = await forceSyncNow();

      if (result.success) {
        addDebugLog('Manual sync started successfully');
        Alert.alert('Sync Started', 'Manual sync has been initiated. Check debug logs for progress.');
        setTimeout(updateSyncStatus, 2000);
      } else {
        addDebugLog(`Sync failed: ${result.message}`);
        Alert.alert('Sync Error', `Failed to start sync: ${result.message}`);
      }
    } catch (error) {
      const errorMsg = `Force sync error: ${error.message}`;
      addDebugLog(errorMsg);
      console.error('❌ Error forcing sync:', error);
      Alert.alert('Error', errorMsg);
    }
  };

  const handleToggleSync = () => {
    const newSyncEnabled = !syncStatus.syncEnabled;
    setSyncEnabled(newSyncEnabled);

    addDebugLog(`Sync ${newSyncEnabled ? 'enabled' : 'disabled'}`);
    Alert.alert(
      'Sync Settings',
      `Sync has been ${newSyncEnabled ? 'enabled' : 'disabled'}`
    );

    setTimeout(updateSyncStatus, 1000);
  };

  const handleSetupDatabase = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Cannot setup database while offline.');
      return;
    }

    try {
      addDebugLog('Setting up CouchDB databases...');
      const result = await createCouchDBDatabases();
      if (result.success) {
        addDebugLog('Database setup completed successfully');
        Alert.alert('Success', 'CouchDB databases verified/created successfully!');
      } else {
        addDebugLog(`Database setup failed: ${result.message}`);
        Alert.alert('Error', `Database setup failed: ${result.message}`);
      }
    } catch (error) {
      const errorMsg = `Database setup error: ${error.message}`;
      addDebugLog(errorMsg);
      Alert.alert('Error', errorMsg);
    }
  };

  // Rest of your component methods (getSyncStatusText, getSyncStatusColor, renderItem, renderDebugPanel)...
  const getSyncStatusText = () => {
    if (!dbReady) {
      return '🔧 Initializing...';
    }

    if (!syncStatus.syncEnabled) {
      return '⏸️ Sync Disabled';
    }

    if (!syncStatus.isOnline) {
      return '📱 Offline Mode';
    }

    if (syncStatus.businessSyncActive || syncStatus.articleSyncActive) {
      return '🔄 Syncing...';
    }

    return '✅ Online & Ready';
  };

  const getSyncStatusColor = () => {
    if (!dbReady) {
      return '#9E9E9E';
    }

    if (!syncStatus.syncEnabled) {
      return '#9E9E9E';
    }

    if (!syncStatus.isOnline) {
      return '#FF9800';
    }

    if (syncStatus.businessSyncActive || syncStatus.articleSyncActive) {
      return '#2196F3';
    }

    return '#4CAF50';
  };

  const renderItem = ({ item }) => (
    <View style={styles.itemContainer}>
      <View style={styles.businessInfo}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.id}>ID: {item.id.substring(0, 8)}...</Text>
      </View>
      <View style={styles.actionButtons}>
        <TouchableOpacity
          onPress={() => handleEditBusiness(item)}
          style={styles.actionButton}
        >
          <Text style={styles.editButton}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDelete(item.id)}
          style={styles.actionButton}
        >
          <Text style={styles.delete}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderDebugPanel = () => (
    <View style={styles.debugPanel}>
      <View style={styles.debugHeader}>
        <Text style={styles.debugTitle}>Debug Information</Text>
        <TouchableOpacity onPress={() => setShowDebugPanel(false)}>
          <Text style={styles.closeButton}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.debugContent}>
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>Current Status:</Text>
          <Text style={styles.debugText}>CouchDB URL: {syncStatus.currentUrl}</Text>
          <Text style={styles.debugText}>Businesses DB: {syncStatus.businessesDB}</Text>
          <Text style={styles.debugText}>Articles DB: {syncStatus.articlesDB}</Text>
          <Text style={styles.debugText}>Online: {syncStatus.isOnline ? 'Yes' : 'No'}</Text>
          <Text style={styles.debugText}>Sync Enabled: {syncStatus.syncEnabled ? 'Yes' : 'No'}</Text>
          <Text style={styles.debugText}>Business Sync: {syncStatus.businessSyncActive ? 'Active' : 'Idle'}</Text>
          <Text style={styles.debugText}>Article Sync: {syncStatus.articleSyncActive ? 'Active' : 'Idle'}</Text>
        </View>

        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>Recent Logs:</Text>
          {debugLogs.map((log, index) => (
            <Text key={index} style={styles.debugLogText}>{log}</Text>
          ))}
        </View>

        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>🎯 Known Working URL Test:</Text>
          <View style={styles.debugButtons}>
            <Button title="Test 192.168.1.100:5984" onPress={handleForceWorkingURL} />
          </View>
        </View>

        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>🔄 Refresh Options:</Text>
          <View style={styles.debugButtons}>
            <Button title="Normal Refresh" onPress={onRefresh} />
            <Button title="Server Refresh" onPress={onRefreshFromServer} />
            <Button title="Local Only" onPress={fetchBusinesses} />
            <Button title="Check Local Storage" onPress={handleCheckLocalStorage} />
          </View>
        </View>

        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>⚠️ Danger Zone:</Text>
          <View style={styles.debugButtons}>
            <Button title="Verify Empty" onPress={handleVerifyEmpty} />
            <Button
              title="PERMANENT RESET"
              onPress={handlePermanentReset}
              color="red"
            />
          </View>
        </View>

        <Button title="Push Local Data" onPress={handlePushData} />

        <View style={styles.debugButtons}>
          <Button title="Test Connectivity" onPress={handleTestConnectivity} />
          <Button title="Setup Databases" onPress={handleSetupDatabase} />
          <Button title="Clear Logs" onPress={() => setDebugLogs([])} />
        </View>
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Network & Sync Status */}
      <View style={[styles.statusBar, { backgroundColor: getSyncStatusColor() }]}>
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>
            {getSyncStatusText()}
          </Text>
          <View style={styles.statusButtons}>
            <TouchableOpacity
              onPress={() => setShowDebugPanel(true)}
              style={styles.syncButton}
            >
              <Text style={styles.syncButtonText}>🐛</Text>
            </TouchableOpacity>
            {dbReady && (
              <TouchableOpacity onPress={handleToggleSync} style={styles.syncButton}>
                <Text style={styles.syncButtonText}>
                  {syncStatus.syncEnabled ? '⏸️' : '▶️'}
                </Text>
              </TouchableOpacity>
            )}
            {isOnline && syncStatus.syncEnabled && dbReady && (
              <>
                <TouchableOpacity onPress={handleSetupDatabase} style={styles.syncButton}>
                  <Text style={styles.syncButtonText}>🔧</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleForceSync} style={styles.syncButton}>
                  <Text style={styles.syncButtonText}>🔄</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>

      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          📦 {storageStats.businesses} Businesses | 🧾 {storageStats.articles} Articles
        </Text>
        <Text style={styles.statsSubText}>
          Business Sync: {syncStatus.businessSyncActive ? '🟢 Active' : '⚪ Idle'} |
          Article Sync: {syncStatus.articleSyncActive ? '🟢 Active' : '⚪ Idle'}
        </Text>
      </View>

      <View style={styles.content}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Enter business name"
          style={styles.input}
          editable={dbReady}
        />
        <Button
          title="Add Business"
          onPress={handleAddBusiness}
          disabled={!dbReady}
        />

        <Text style={styles.heading}>📦 Business List ({businesses.length})</Text>
        <FlatList
          data={businesses}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {!dbReady ? 'Initializing database...' : 'No businesses added yet.'}
              {'\n'}
              {!isOnline && 'Data will sync when you go online.'}
              {!syncStatus.syncEnabled && '\nSync is currently disabled.'}
            </Text>
          }
        />
      </View>

      {/* Debug Panel Modal */}
      {showDebugPanel && renderDebugPanel()}
      <EditBusinessModal
        visible={editModalVisible}
        business={selectedBusiness}
        onClose={() => {
          setEditModalVisible(false);
          setSelectedBusiness(null);
        }}
        onUpdate={handleBusinessUpdated}
      />
    </View>
  );
};

export default BusinessScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  statusBar: {
    padding: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
    flex: 1,
  },
  statusButtons: {
    flexDirection: 'row',
  },
  syncButton: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 4,
  },
  syncButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  statsBar: {
    backgroundColor: '#f5f5f5',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statsText: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  statsSubText: {
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  heading: {
    fontSize: 18,
    marginVertical: 10,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  itemContainer: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  businessInfo: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  id: {
    fontSize: 12,
    color: 'gray',
    marginTop: 2,
  },
  delete: {
    fontSize: 18,
    padding: 8,
  },
  empty: {
    textAlign: 'center',
    marginTop: 20,
    color: 'gray',
  },
  debugPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    zIndex: 1000,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#333',
  },
  debugTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  debugContent: {
    flex: 1,
    padding: 16,
  },
  debugSection: {
    marginBottom: 20,
  },
  debugSectionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  debugText: {
    color: '#ccc',
    fontSize: 12,
    marginBottom: 4,
  },
  debugLogText: {
    color: '#aaa',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  debugButtons: {
    gap: 10,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
  editButton: {
    fontSize: 18,
  },
});